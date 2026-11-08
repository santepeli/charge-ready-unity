using UnityEngine;

namespace ChargeReady
{
    // Every tunable number of the first station, kept in one asset; mirrors config.js of the browser prototype.
    [CreateAssetMenu(menuName = "Charge Ready/Economy Config", fileName = "EconomyConfig")]
    public class EconomyConfig : ScriptableObject
    {
        [Header("Economy")]
        public int startCash = 0;
        public float costMultiplier = 1.6f;
        public float incomeMultiplier = 1.3f;
        public int chargeFeeBase = 6;
        public int mealPrice = 4;

        [Header("Upgrades")]
        public int tariffBaseCost = 30;
        public int capacityBaseCost = 25;
        public int speedBaseCost = 35;
        public int maxLevel = 5;
        public int trayStart = 3;
        public float chargeStartSec = 6f;
        public float chargeFactor = 0.85f;

        [Header("Bays")]
        public int bayBaseCost = 50;
        public Vector2[] bays = { new Vector2(0.45f, -4f), new Vector2(3.45f, -4f), new Vector2(6.45f, -4f), new Vector2(9.45f, -4f) };

        [Header("Gameplay")]
        public int orderSize = 2;
        public float walkSpeed = 2.6f;
        public float eatSec = 3f;
        public float machineSec = 1.2f;
        public int machineMax = 8;
        public float playerSpeed = 6.5f;
        public float carSpawnSec = 1f;
        public float carSpeed = 11f;
        public float padFillSec = 1f;
        public float pickupSec = 0.15f;
        public float deliverSec = 0.2f;
        public float reach = 1.5f;

        [Header("Layout")]
        public Vector2 kitchen = new Vector2(-4.6f, -11.8f);
        public Vector2[] tables = { new Vector2(-6.5f, -7f), new Vector2(-3.5f, -7f), new Vector2(-6.5f, -3f), new Vector2(-3.5f, -3f) };
        public Vector2 playerSpawn = new Vector2(-1.5f, -6f);
        public float roadX = 15.6f;
        public float inLane = 14.9f;
        public float outLane = 16.3f;
        public float spawnZ = -40f;
        public float exitZ = 34f;
        public float aisle = 2.7f;
        public Vector3 cameraOffset = new Vector3(0f, 28.9f, 24.2f);
        public float fieldOfView = 35f;

        public int UpgradeCost(int baseCost, int level) => Mathf.RoundToInt(baseCost * Mathf.Pow(costMultiplier, level));
        public int ChargeFee(int tariff) => Mathf.RoundToInt(chargeFeeBase * Mathf.Pow(incomeMultiplier, tariff));
        public float ChargeSec(int speed) => chargeStartSec * Mathf.Pow(chargeFactor, speed);
    }
}
