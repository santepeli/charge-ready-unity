using System.Collections.Generic;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace ChargeReady
{
    // Builds Greenfield Town from code and runs its loop: cars charge, drivers eat, the player carries burgers and collects cash.
    public class Game : MonoBehaviour
    {
        class Bay { public Vector3 pos; public bool built; public Car car; public int cash; public Transform pile, bar; }
        class Car { public Transform t; public Bay bay; public List<Vector3> path = new List<Vector3>(); public string phase = "in"; public float charge; public Driver driver; public bool back; }
        class Driver { public Transform t; public Car car; public int table = -1; public string phase = "walk"; public int want; public float timer; public Vector3 target; }

        static readonly Color Grass = new Color(0.55f, 0.78f, 0.45f), Lot = new Color(0.94f, 0.9f, 0.84f), Road = new Color(0.23f, 0.27f, 0.35f);
        static readonly Color Ink = new Color(0.08f, 0.14f, 0.23f), Volt = new Color(0.18f, 0.89f, 0.61f), Gold = new Color(1f, 0.82f, 0.25f), Bun = new Color(0.85f, 0.55f, 0.25f);
        static readonly Color[] CarColors = { new Color(0.9f, 0.3f, 0.25f), new Color(0.3f, 0.6f, 0.95f), new Color(0.95f, 0.8f, 0.3f), new Color(0.6f, 0.4f, 0.85f), new Color(0.95f, 0.95f, 0.95f) };

        EconomyConfig cfg;
        Camera cam;
        Transform player, kitchenTop, pad;
        readonly List<Bay> bays = new List<Bay>();
        readonly List<Car> cars = new List<Car>();
        readonly List<Transform> machine = new List<Transform>(), tray = new List<Transform>();
        bool[] tableBusy;
        int cash, tariff, capacity, speed;
        float spawnT, machineT, actT, padPaid, saveT;
        Vector2? dragFrom;
        Rect[] buttons = new Rect[3];

        // Any scene that starts without a Game gets one, so an empty scene is enough to play.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (FindAnyObjectByType<Game>() == null) new GameObject("Game").AddComponent<Game>();
        }

        void Start()
        {
            Application.targetFrameRate = 60;
            Screen.orientation = ScreenOrientation.Portrait;
            cfg = Resources.Load<EconomyConfig>("EconomyConfig");
            baseMat = Resources.Load<Material>("Lit");
            if (cfg == null) cfg = ScriptableObject.CreateInstance<EconomyConfig>();
            Load();
            BuildWorld();
        }

        // Plain boxes and capsules are the whole art for now; colliders are removed because the game moves things itself.
        // Every shape copies this material, so its shader ships with the build instead of being stripped.
        static Material baseMat;

        static Transform Shape(PrimitiveType type, Vector3 pos, Vector3 size, Color color, Transform parent = null)
        {
            var go = GameObject.CreatePrimitive(type);
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = size;
            var r = go.GetComponent<Renderer>();
            if (baseMat != null) r.sharedMaterial = new Material(baseMat);
            r.material.color = color;
            return go.transform;
        }

        static Vector3 V(Vector2 p) => new Vector3(p.x, 0f, p.y);

        void BuildWorld()
        {
            var camGo = new GameObject("Camera");
            cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = cfg.fieldOfView;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Grass;
            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.transform.rotation = Quaternion.Euler(55f, -30f, 0f);
            sun.shadows = LightShadows.Soft;
            RenderSettings.ambientLight = new Color(0.62f, 0.66f, 0.72f);

            Shape(PrimitiveType.Cube, new Vector3(0f, -0.25f, 0f), new Vector3(80f, 0.2f, 80f), Grass);
            Shape(PrimitiveType.Cube, new Vector3(1f, -0.1f, -2f), new Vector3(21f, 0.1f, 28f), Lot);
            Shape(PrimitiveType.Cube, new Vector3(cfg.roadX, -0.12f, 0f), new Vector3(3.2f, 0.1f, 80f), Road);
            for (float z = -38f; z < 38f; z += 4f) Shape(PrimitiveType.Cube, new Vector3(cfg.roadX, -0.05f, z), new Vector3(0.12f, 0.02f, 1.6f), Lot);

            var k = V(cfg.kitchen);
            Shape(PrimitiveType.Cube, k + new Vector3(0f, 0.6f, 0f), new Vector3(3f, 1.2f, 1.4f), Ink);
            kitchenTop = Shape(PrimitiveType.Cube, k + new Vector3(0f, 1.25f, 0f), new Vector3(2.6f, 0.1f, 1f), Lot);
            tableBusy = new bool[cfg.tables.Length];
            foreach (var t in cfg.tables) Shape(PrimitiveType.Cylinder, V(t) + new Vector3(0f, 0.4f, 0f), new Vector3(1.4f, 0.4f, 1.4f), Bun);

            for (int i = 0; i < cfg.bays.Length; i++)
            {
                var b = new Bay { pos = V(cfg.bays[i]) };
                bays.Add(b);
                if (i < BuiltBays()) BuildBay(b);
            }
            pad = Shape(PrimitiveType.Cube, Vector3.zero, new Vector3(2.4f, 0.06f, 2.4f), Gold);
            PlacePad();

            player = Person(V(cfg.playerSpawn), new Color(1f, 0.45f, 0.2f));
            for (int i = 0; i < cfg.machineMax; i++) { var m = Burger(kitchenTop, new Vector3(-0.9f + (i % 4) * 0.6f, 0.15f + (i / 4) * 0.25f, 0f)); m.gameObject.SetActive(false); machine.Add(m); }
        }

        int built;
        int BuiltBays() => Mathf.Max(1, built);

        void BuildBay(Bay b)
        {
            b.built = true;
            Shape(PrimitiveType.Cube, b.pos + new Vector3(0f, 0.01f, 0f), new Vector3(2.4f, 0.04f, 4f), Volt * 0.8f);
            Shape(PrimitiveType.Cube, b.pos + new Vector3(-1.4f, 0.75f, -1.4f), new Vector3(0.5f, 1.5f, 0.4f), Ink);
            b.bar = Shape(PrimitiveType.Cube, b.pos + new Vector3(-1.4f, 1.8f, -1.4f), new Vector3(0.05f, 0.18f, 0.1f), Volt);
            b.pile = Shape(PrimitiveType.Cube, b.pos + new Vector3(0f, 0.1f, 2.8f), new Vector3(0.7f, 0.1f, 0.45f), new Color(0.3f, 0.75f, 0.35f));
            b.pile.gameObject.SetActive(b.cash > 0);
        }

        Transform Person(Vector3 pos, Color color)
        {
            var root = new GameObject("Person").transform;
            root.position = pos;
            Shape(PrimitiveType.Capsule, new Vector3(0f, 0.75f, 0f), new Vector3(0.7f, 0.75f, 0.7f), color, root);
            Shape(PrimitiveType.Sphere, new Vector3(0f, 1.75f, 0f), new Vector3(0.6f, 0.6f, 0.6f), new Color(1f, 0.82f, 0.67f), root);
            return root;
        }

        Transform Burger(Transform parent, Vector3 local) => Shape(PrimitiveType.Cylinder, local, new Vector3(0.5f, 0.1f, 0.5f), Bun, parent);

        Transform MakeCar(Color color)
        {
            var root = new GameObject("Car").transform;
            Shape(PrimitiveType.Cube, new Vector3(0f, 0.5f, 0f), new Vector3(1.6f, 0.6f, 3f), color, root);
            Shape(PrimitiveType.Cube, new Vector3(0f, 1f, 0.2f), new Vector3(1.4f, 0.5f, 1.6f), new Color(0.2f, 0.3f, 0.4f), root);
            return root;
        }

        void PlacePad()
        {
            int next = bays.FindIndex(b => !b.built);
            pad.gameObject.SetActive(next >= 0);
            if (next >= 0) pad.position = bays[next].pos + new Vector3(0f, 0.04f, 0f);
        }

        int PadCost() => cfg.UpgradeCost(cfg.bayBaseCost, bays.FindAll(b => b.built).Count - 1);

        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.05f);
            MovePlayer(dt);
            SpawnCars(dt);
            RunMachine(dt);
            foreach (var c in cars.ToArray()) RunCar(c, dt);
            Act(dt);
            FollowCamera();
            if ((saveT += dt) > 5f) { saveT = 0f; Save(); }
        }

        // Drag anywhere: the offset from where the finger went down steers the player, like a floating joystick.
        void MovePlayer(float dt)
        {
            Vector2 pos;
            if (!Pressed(out pos) || OverButton(pos)) { dragFrom = null; return; }
            if (dragFrom == null) dragFrom = pos;
            var d = (pos - dragFrom.Value) / (Screen.height * 0.08f);
            if (d.magnitude < 0.1f) return;
            d = Vector2.ClampMagnitude(d, 1f);
            var move = new Vector3(d.x, 0f, -d.y);
            var p = player.position + move * cfg.playerSpeed * dt;
            player.position = new Vector3(Mathf.Clamp(p.x, -9.5f, 11.6f), 0f, Mathf.Clamp(p.z, -15.6f, 11f));
            player.rotation = Quaternion.LookRotation(move);
        }

        static bool Pressed(out Vector2 pos)
        {
#if ENABLE_INPUT_SYSTEM
            var p = Pointer.current;
            pos = p != null ? p.position.ReadValue() : Vector2.zero;
            return p != null && p.press.isPressed;
#else
            if (Input.touchCount > 0) { pos = Input.GetTouch(0).position; return true; }
            pos = Input.mousePosition;
            return Input.GetMouseButton(0);
#endif
        }

        // Screen positions start at the bottom; GUI rects start at the top, scaled by the GUI matrix.
        bool OverButton(Vector2 pos)
        {
            float s = Screen.height / 844f;
            var gui = new Vector2(pos.x / s, (Screen.height - pos.y) / s);
            foreach (var r in buttons) if (r.Contains(gui)) return true;
            return false;
        }

        void SpawnCars(float dt)
        {
            if ((spawnT -= dt) > 0f) return;
            spawnT = cfg.carSpawnSec;
            var bay = bays.Find(b => b.built && b.car == null);
            if (bay == null) return;
            var c = new Car { bay = bay, t = MakeCar(CarColors[Random.Range(0, CarColors.Length)]) };
            bay.car = c;
            c.t.position = new Vector3(cfg.inLane, 0f, cfg.spawnZ);
            float top = bay.pos.z - cfg.aisle;
            c.path.Add(new Vector3(cfg.inLane, 0f, top));
            c.path.Add(new Vector3(bay.pos.x, 0f, top));
            c.path.Add(bay.pos);
            cars.Add(c);
        }

        // Moves a car along its path; true once it reaches the end.
        bool Drive(Car c, float dt)
        {
            if (c.path.Count == 0) return true;
            var to = c.path[0];
            var dir = to - c.t.position;
            if (dir.sqrMagnitude > 0.001f) c.t.rotation = Quaternion.Slerp(c.t.rotation, Quaternion.LookRotation(dir), dt * 10f);
            c.t.position = Vector3.MoveTowards(c.t.position, to, cfg.carSpeed * dt);
            if ((c.t.position - to).sqrMagnitude < 0.0001f) c.path.RemoveAt(0);
            return c.path.Count == 0;
        }

        void RunCar(Car c, float dt)
        {
            if (c.phase == "in" && Drive(c, dt))
            {
                c.phase = "charge";
                int table = System.Array.IndexOf(tableBusy, false);
                if (table >= 0)
                {
                    tableBusy[table] = true;
                    c.driver = new Driver { car = c, table = table, t = Person(c.t.position + new Vector3(-1.2f, 0f, 0f), CarColors[Random.Range(0, CarColors.Length)]), target = V(cfg.tables[table]) + new Vector3(0.9f, 0f, 0f) };
                }
                else c.back = true;
            }
            else if (c.phase == "charge")
            {
                float full = cfg.ChargeSec(speed);
                c.charge = Mathf.Min(full, c.charge + dt);
                c.bay.bar.localScale = new Vector3(0.05f + 1.2f * c.charge / full, 0.18f, 0.1f);
                if (c.driver != null) RunDriver(c.driver, dt);
                if (c.charge >= full && c.back)
                {
                    Pay(c.bay, cfg.ChargeFee(tariff));
                    c.phase = "out";
                    float below = c.bay.pos.z + 3f;
                    c.path.Add(new Vector3(c.bay.pos.x, 0f, below));
                    c.path.Add(new Vector3(cfg.outLane, 0f, below));
                    c.path.Add(new Vector3(cfg.outLane, 0f, cfg.exitZ));
                }
            }
            else if (c.phase == "out")
            {
                if (c.bay != null && (c.t.position - c.bay.pos).sqrMagnitude > 9f) { c.bay.bar.localScale = new Vector3(0.05f, 0.18f, 0.1f); c.bay.car = null; c.bay = null; }
                if (Drive(c, dt)) { Destroy(c.t.gameObject); cars.Remove(c); }
            }
        }

        // A driver walks to a free table, waits for burgers, eats, pays and walks back to the car.
        void RunDriver(Driver d, float dt)
        {
            if (d.phase == "walk" || d.phase == "back")
            {
                var dir = d.target - d.t.position;
                if (dir.sqrMagnitude > 0.001f) d.t.rotation = Quaternion.LookRotation(dir);
                d.t.position = Vector3.MoveTowards(d.t.position, d.target, cfg.walkSpeed * dt);
                if ((d.t.position - d.target).sqrMagnitude > 0.0001f) return;
                if (d.phase == "walk") { d.phase = "wait"; d.want = cfg.orderSize; return; }
                tableBusy[d.table] = false;
                Destroy(d.t.gameObject);
                d.car.driver = null;
                d.car.back = true;
            }
            else if (d.phase == "eat" && (d.timer -= dt) <= 0f)
            {
                Pay(d.car.bay, cfg.mealPrice * cfg.orderSize);
                d.phase = "back";
                d.target = d.car.t.position + new Vector3(-1.2f, 0f, 0f);
            }
        }

        void Pay(Bay b, int amount)
        {
            b.cash += amount;
            b.pile.gameObject.SetActive(true);
            b.pile.localScale = new Vector3(0.7f, 0.1f + Mathf.Min(b.cash, 60) * 0.01f, 0.45f);
        }

        void RunMachine(float dt)
        {
            int stock = machine.FindAll(m => m.gameObject.activeSelf).Count;
            if (stock >= cfg.machineMax || (machineT += dt) < cfg.machineSec) return;
            machineT = 0f;
            machine[stock].gameObject.SetActive(true);
        }

        // One action per tick near the player: take a burger, hand one over, collect a cash pile or pay into the build pad.
        void Act(float dt)
        {
            var p = player.position;
            if (pad.gameObject.activeSelf && Near(p, pad.position, 1.3f) && cash > 0)
            {
                int cost = PadCost(), step = Mathf.Min(cash, Mathf.Max(1, Mathf.CeilToInt(cost * dt / cfg.padFillSec)), cost - Mathf.RoundToInt(padPaid));
                cash -= step;
                padPaid += step;
                if (padPaid >= cost) { padPaid = 0f; built = bays.FindAll(b => b.built).Count + 1; BuildBay(bays.Find(b => !b.built)); PlacePad(); Save(); }
            }
            foreach (var b in bays) if (b.built && b.cash > 0 && Near(p, b.pile.position, cfg.reach)) { cash += b.cash; b.cash = 0; b.pile.gameObject.SetActive(false); }
            if ((actT -= dt) > 0f) return;
            int stock = machine.FindAll(m => m.gameObject.activeSelf).Count;
            if (Near(p, kitchenTop.position, 2f) && stock > 0 && tray.Count < cfg.trayStart + capacity)
            {
                machine[stock - 1].gameObject.SetActive(false);
                tray.Add(Burger(player, new Vector3(0f, 2.2f + tray.Count * 0.2f, 0.5f)));
                actT = cfg.pickupSec;
                return;
            }
            if (tray.Count == 0) return;
            foreach (var c in cars)
            {
                var d = c.driver;
                if (d == null || d.phase != "wait" || !Near(p, V(cfg.tables[d.table]), cfg.reach + 0.6f)) continue;
                Destroy(tray[tray.Count - 1].gameObject);
                tray.RemoveAt(tray.Count - 1);
                if (--d.want == 0) { d.phase = "eat"; d.timer = cfg.eatSec; }
                actT = cfg.deliverSec;
                return;
            }
        }

        static bool Near(Vector3 a, Vector3 b, float r) => (new Vector2(a.x - b.x, a.z - b.z)).sqrMagnitude <= r * r;

        void FollowCamera()
        {
            var focus = new Vector3(Mathf.Clamp(player.position.x, -5f, 7.5f), 0f, Mathf.Clamp(player.position.z, -12f, 6f));
            cam.transform.position = focus + cfg.cameraOffset;
            cam.transform.LookAt(focus);
        }

        void OnGUI()
        {
            float s = Screen.height / 844f;
            GUI.matrix = Matrix4x4.Scale(new Vector3(s, s, 1f));
            float w = Screen.width / s;
            var big = new GUIStyle(GUI.skin.box) { fontSize = 30, fontStyle = FontStyle.Bold };
            GUI.Box(new Rect(16f, 40f, 180f, 56f), "$" + cash, big);
            var btn = new GUIStyle(GUI.skin.button) { fontSize = 18, wordWrap = true };
            string[] names = { "Prices", "Bigger Tray", "Fast Chargers" };
            int[] levels = { tariff, capacity, speed }, costs = { cfg.tariffBaseCost, cfg.capacityBaseCost, cfg.speedBaseCost };
            float bw = (w - 48f) / 3f;
            for (int i = 0; i < 3; i++)
            {
                buttons[i] = new Rect(16f + i * (bw + 8f), 844f - 110f, bw, 80f);
                bool max = levels[i] >= cfg.maxLevel;
                int cost = cfg.UpgradeCost(costs[i], levels[i]);
                GUI.enabled = !max && cash >= cost;
                if (GUI.Button(buttons[i], names[i] + "\n" + (max ? "MAX" : "$" + cost), btn)) Buy(i, cost);
                GUI.enabled = true;
            }
            if (pad.gameObject.activeSelf)
            {
                var sp = cam.WorldToScreenPoint(pad.position);
                var label = new GUIStyle(GUI.skin.label) { fontSize = 24, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
                GUI.Label(new Rect(sp.x / s - 80f, (Screen.height - sp.y) / s - 60f, 160f, 40f), "Charger $" + (PadCost() - Mathf.RoundToInt(padPaid)), label);
            }
        }

        void Buy(int line, int cost)
        {
            cash -= cost;
            if (line == 0) tariff++;
            else if (line == 1) capacity++;
            else speed++;
            Save();
        }

        void Load()
        {
            cash = PlayerPrefs.GetInt("cash", cfg.startCash);
            tariff = PlayerPrefs.GetInt("tariff", 0);
            capacity = PlayerPrefs.GetInt("capacity", 0);
            speed = PlayerPrefs.GetInt("speed", 0);
            built = PlayerPrefs.GetInt("bays", 1);
        }

        void Save()
        {
            PlayerPrefs.SetInt("cash", cash);
            PlayerPrefs.SetInt("tariff", tariff);
            PlayerPrefs.SetInt("capacity", capacity);
            PlayerPrefs.SetInt("speed", speed);
            PlayerPrefs.SetInt("bays", BuiltBays());
            PlayerPrefs.Save();
        }

        void OnApplicationPause(bool paused) { if (paused) Save(); }
    }
}
