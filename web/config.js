// Single source for every tunable value; maps 1:1 to the Unity ScriptableObject.
// Real sizes in metres; `unit` world units make one metre, and people with the props they use get `cartoon` so they read on a phone.
const REAL = { unit: 0.72, cartoon: 1.5, cartoonKeys: ['person', 'charger', 'scooter'], car: 4.5, limo: 5.2, van: 4.2, tow: 6.4, truck: 7, bus: 8, person: 1.75, charger: 1.9, scooter: 1.8 };
// Gap between queued cars: one car length plus a little air, so lines never overlap whatever the car size.
const CAR_GAP = REAL.car * REAL.unit + 0.6;

export const CONFIG = {
  economy: {
    startCash: 0,
    costMultiplier: 1.6,
    incomeMultiplier: 1.3,
    chargeFeeBase: 6,
    mealPrice: 4,
    idleFeePerSec: 1,
    offlineCapSec: 7200,
    // Away earnings: half the station's measured income per second; saves without a measured rate fall back to bays × fee / offlineSecPerCar.
    offlineShare: 0.5,
    offlineSecPerCar: 60,
  },
  upgrades: {
    tariff: { name: 'Prices', baseCost: 30, maxLevel: 5 },
    capacity: { name: 'Bigger Tray', baseCost: 25, maxLevel: 5, start: 3, step: 1 },
    speed: { name: 'Fast Chargers', baseCost: 35, maxLevel: 5, startSec: 6, factor: 0.85 },
  },
  unlocks: {
    bay: { baseCost: 50 },
    worker: { cost: 180 },
    office: { cost: 150 },
    accounting: { cost: 100 },
    coffee: { cost: 150 },
    wash: { cost: 480 },
  },
  pads: [{ type: 'bay' }, { type: 'bay' }, { type: 'worker' }, { type: 'office' }, { type: 'accounting' }, { type: 'bay' }],
  gameplay: {
    orderSize: 2,
    walkSpeed: 2.6,
    patienceSec: 12,
    eatSec: 3,
    idleGraceSec: 1,
    machineMax: 8,
    machineSec: 1.2,
    plugSec: 0.3,
    selfPlugSec: 4,
    workerCap: 3,
    playerSpeed: 6.5,
    // How fast walkers turn toward where they head (share of the gap closed per second); 25 swings round in about 0.1 s.
    turnRate: 25,
    // The owner's body radius against solid cars, buildings and machines.
    ownerRadius: 0.35, nudgeRate: 8,
    workerSpeed: 4.5,
    arriveDist: 0.6,
    pickupSec: 0.15,
    deliverSec: 0.2,
    carSpawnSec: 1,
    carStartCharge: [0.05, 0.2],
    padFillSec: 1,
    cashPerBill: 5,
    maxBills: 12,
    tutorialCars: 3,
    // The ground pointer sits pointerAt units from the owner toward the next step and hides within pointerMin of it.
    pointerAt: 1.1, pointerMin: 2.2,
    maxDt: 0.05,
    stallSec: 0.25,
    bobSpeed: 4,
  },
  // yield*: a vehicle waits while a yieldStep move would touch another's body (inset by yieldInset); past yieldSec it is stuck and goes on.
  // In a turn a car drives at its nose's alignment with the way it goes, never below turnSlow of full speed. A car within exitMouth of its
  // bay spot waits there while another vehicle is within exitClear of where it would join the exit lane.
  road: { x: 15.6, width: 3.2, inLane: 14.9, outLane: 16.3, serviceLane: 12.4, spawnZ: -40, exitZ: 34, speed: 11, turnRate: 9, trafficEverySec: 4, yieldSec: 60, yieldStep: 0.6, yieldInset: 0.3, spawnRoom: 5, turnSlow: 0.15, exitClear: 4, exitMouth: 0.3, mergeLook: 9 },
  // A real fix during a jam (new charger, worker, boost, faster chargers, bigger tray, vans) holds the police off for holdSec.
  // From the second charger on, slow service sends extra drivers to the in-lane queue: one per stallSecPerCar of cars waiting for a plug or food; a long queue jams the road.
  // A jam that lasts jamSec brings the police: the first jam only gets a warning, later ones a growing fine that can push cash below zero.
  traffic: {
    fromBays: 2, holdSec: 30, holdUpgrades: ['speed', 'capacity', 'vans', 'vanSpeed'], stallSecPerCar: 7, frontZ: -10, gap: CAR_GAP, patienceSec: 35, jamAt: 5, jamSec: 25, fineBase: 40, fineGrowth: 1.5, fineMax: 160, fineRound: 5, divertKm: 0.6,
    // Police park at the lot spot nearest the manager (or the owner); the officer walks over, talks, writes the ticket and drives off.
    // The police car parks `beside` units to the right of the owner, inside the lot.
    police: { door: [-1.3, 0], talkSec: 2.2, chaseSec: 8, cardMs: 3800, light: 30, lightRange: 12, blinkHz: 6 } },
  // Manager office: staff report shortages; the owner stands at the manager's desk and orders a boost or sends him to wake a slacking worker.
  staff: {
    slackEverySec: [60, 100], slackMaxSec: 20, wakeDist: 1.3, slackSpot: [-8.6, 0.6], kinds: ['💤', '📱'],
    office: [3, 4.8], desk: [3, 4.45], officeZone: [3, 2.5], officeZoneSize: [2.6, 1], talkDist: 2, managerSpeed: 4.2, talkSec: 1.5, reportSec: 3, cooldownSec: 45,
    boosts: {
      kitchen: { name: 'Kitchen Rush', cost: 40, sec: 40, factor: 2, line: 'The kitchen can\'t keep up!', info: 'Kitchen cooks twice as fast for 40s', sources: ['meal'], gain: 0.6 },
      speed: { name: 'Double Speed', cost: 35, sec: 30, factor: 2, line: 'Cars are waiting for a plug!', info: 'Your worker moves twice as fast for 30s', sources: ['charge', 'meal'], gain: 0.3 },
      extra: { name: 'Extra Hand', cost: 60, sec: 45, line: 'The queue is getting long!', info: 'A temp worker helps for 45s', sources: ['charge', 'meal'], gain: 0.3, fineRisk: true },
    },
    // Accounting office: books every dollar in and out and prices each boost for the owner.
    // A boost's expected value = income per second of its sources (last windowSec) × gain × seconds, plus the fine it may prevent.
    accounting: { office: [7.5, 4.8], desk: [7.5, 4.45], pad: [7.5, 2.5], windowSec: 60, stackPer: 50, maxStack: 14, decisions: 4 },
  },
  // Drive-thru coffee after Station 1: drivers stay in the car at the kiosk window and pay per cup.
  // Drive-thru on the one-way service lane beside the road: cars come down it, stop at the window and merge back onto the road below the lot.
  coffee: { padAt: [9.8, -10.3], kioskAt: [10, -12.5], kioskTurn: 0, zone: [2.4, 1.6], windowAt: [12.4, -12.5], spawnAt: [12.4, -40], lineMax: 4, gap: CAR_GAP, cupPrice: 4, cups: [1, 2], everySec: [9, 15], patienceSec: 40,
    // A hired barista stands behind the counter and hands out a cup every baristaSec while the front car waits.
    baristaAt: [10.6, -12.2], baristaSec: 0.9, machineSec: 1.5, machineMax: 6, serveSec: 0.3, cup: { r: 0.19, h: 0.36 },
    upgrades: { coffeePrice: { name: 'Coffee Price', baseCost: 60, maxLevel: 3 }, espresso: { name: 'Espresso Machine', baseCost: 50, maxLevel: 3, factor: 0.8 }, barista: { name: 'Hire Barista', baseCost: 120, maxLevel: 1 } } },
  // Stage names and icons; a station opens its stages in the order its `stages` list gives, after the charging and diner stage.
  // Expansions after a station is complete (station.extras gives where each stands): they add income but no stars.
  // Moto Park: e-scooters ride in from the road, charge for chargeSec and pay fee. Mini Mart: charging drivers walk over and buy one item
  // for price while stock lasts; the player restocks by standing at the shelf. Air & Glass: a charging car asks for air or a wipe; the
  // player picks the tool at the post and walks to the car within waitSec for fee. cashAt is the pile's offset from the building.
  // Upgrades: more moto slots and faster chargers; bigger shelves and a clerk who restocks at clerkShare of the player's pace;
  // a pricier service and an attendant who finishes an ask after attendantSec.
  extras: {
    order: ['moto', 'mart', 'air'], cashZone: [2, 1.4],
    moto: { name: 'Moto Park', icon: '🛵', cost: 500, spots: 3,
      upgrades: { motoSlots: { name: 'More Moto Slots', baseCost: 150, maxLevel: 2 }, motoFast: { name: 'Fast Moto Chargers', baseCost: 180, maxLevel: 3, factor: 0.8 } }, gap: 1.45, everySec: [5, 9], chargeSec: 4, fee: 3, laneZ: 2.6, cashAt: [2.6, -1], colors: ['#ff6b3d', '#4dabff', '#ffd23f', '#2fe39b'] },
    mart: { name: 'Mini Mart', icon: '🛒', cost: 700, everySec: [6, 10],
      upgrades: { martShelf: { name: 'Bigger Shelves', baseCost: 160, maxLevel: 2, step: 4 }, martClerk: { name: 'Hire Shop Clerk', baseCost: 260, maxLevel: 1 } }, clerkShare: 0.25, clerkAt: [1.4, 0.2], price: 5, stock: 8, restockPerSec: 4, walk: 3, shelfZone: [0, -0.2], zoneSize: [3, 1.2], cashAt: [2.6, 0.9],
      goods: { town: 'Snacks', highway: 'Ice & water', airport: 'Neck pillows', hotel: 'Sunscreen' } },
    air: { name: 'Air & Glass', icon: '💨', cost: 400, everySec: [8, 14],
      upgrades: { airPrice: { name: 'Premium Service', baseCost: 140, maxLevel: 3, step: 0.25 }, airAttendant: { name: 'Hire Attendant', baseCost: 300, maxLevel: 1 } }, attendantSec: 6, attendantAt: [0, 0.9], waitSec: 20, fee: 4, reach: 1.8, zoneSize: [2.4, 1.6], cashAt: [-2.4, 0.6] },
  },
  stageInfo: { charge: ['Charging & Diner', '⚡'], coffee: ['Coffee Drive-Thru', '☕'], depot: ['Mobile Charging', '🚐'], wash: ['Car Wash', '🫧'], tire: ['Tire Shop', '🛞'], repair: ['Repair Garage', '🔧'], tow: ['Tow Truck', '🚛'], solar: ['Solar Field', '☀️'], lounge: ['VIP Lounge', '👑'] },
  // Floor power-ups: one appears now and then on a free spot; skates speed the player up, gloves let them carry more.
  powerup: { firstSec: 60, everySec: [40, 70], lifeSec: 20, durSec: 30, factor: 1.8, radius: 1.1, spots: [[3.8, -10.2], [6.5, -12], [-1.4, -15.2]],
    kinds: { speed: { glow: '#ff5fd2', icon: '👟', text: 'Speed' }, carry: { glow: '#5dff7a', icon: '🧤', text: 'Carry' } } },
  // Locked buildings show a painted lock tile on their spot with the stage star; the next one to buy turns into the buy pad.
  ghost: { size: 3, tile: '#e9b67c', pad: '#e9b67c', padFill: '#ffd34d', star: '#ffd23f', starInk: '#7a4b00', ink: '#5a3a1a',
    names: { moto: 'MOTO', mart: 'MART', air: 'AIR', office: 'MANAGER', accounting: 'ACCOUNTS', coffee: 'COFFEE', depot: 'MOBILE', wash: 'CAR WASH', tire: 'TIRES', repair: 'REPAIR', tow: 'TOW', solar: 'SOLAR', lounge: 'VIP' },
    // Unpaved strips read as a construction site: sand plane and a row of striped barriers on the top edge.
    lot: '#d8c7a4', barrier: [1.2, 0.5, 0.18], barrierGap: 2.6 },
  // Side products: the first pads after stage 1; once a machine runs, a driver swaps one food for a side with chance;
  // each machine makes one item every sec up to max on its counter, and the player picks them up in the zone in front.
  side: { carry: 3, chance: 0.5, sec: 1.2, max: 6, at: [[-1.2, -12.4], [1.6, -12.4]], zone: [2.2, 1.8], zoneOffset: 1.5 },
  // Prototype only: what the Settings test button adds to the wallet.
  // Test tools show only while developing: on a local server or with ?dev in the address, never on the public link.
  testHosts: ['localhost', '127.0.0.1'], testParam: 'dev',
  // Playtest feedback goes to a Google Form; the entry ids are the form's rating, comment and context fields.
  feedback: { url: 'https://docs.google.com/forms/d/e/1FAIpQLScung3bIhYeI1f7jp5p0HdvOltBj5MNEGrq6B0dgqT_nHEuJg/formResponse', rating: 'entry.479865998', comment: 'entry.2008571313', context: 'entry.1523141008', build: 'v115', maxChars: 1000 },
  // Ads and shop: rewarded ads are always the player's choice; a break ad shows only after a stage card, not in the first firstSec at the
  // first station and at least gapSec after any ad. The web build plays a mockSec test card; the app build plugs in the ad SDK and store.
  // A pad that is at least padShare paid can be finished with a rewarded ad; the starter pack is offered once after starterAfterSec.
  ads: {
    // Seconds of 'Short ad in…' before a break ad.
    warnSec: 3, mockSec: 3, firstSec: 300, gapSec: 120, padShare: 0.5, starterAfterSec: 420,
    shop: { noAds: { name: 'No Ads', price: '$3.99', info: 'No more break ads. Rewarded bonuses stay.' }, starter: { name: '🎁 Starter Pack', price: '$1.99', info: 'Cash to build faster, plus No Ads forever.', cash: 400 } } },
  // Opening: the logo letters drop in while the camera swoops down from the sky onto the station, then Tap to Play pulses.
  opening: { liftFrom: 3.4, swoopMs: 2600, letterMs: 70, dropMs: 560, boltMs: 900 },
  // Reset in Settings: the second tap counts only after minMs (no double-tap resets) and within armMs of the first.
  resetTap: { minMs: 600, armMs: 4000 },
  testCash: 1000000,
  testSpeeds: [1, 2, 4],
  // Story: Rosa, who ran the old gas station on Route 9, hands it over and cheers the player on in one-line cards.
  story: {
    start: "My old pump, your chargers. The keys are yours!",
    goalsDone: { town: 'Truckers on Route 9 have nowhere to charge.', highway: 'Flights land every minute out by the airport.', airport: 'Guests on the bay need their cars charged by morning.', hotel: 'Shoppers in the city need a plaza that charges.', mall: 'Look at you. Route 9 hums with your chargers.' },
    open: { highway: "Trucks don't wait. Neither do buses.", airport: 'Flights land every minute. Make them feel like VIPs.', hotel: 'Guests sleep, cars charge. Wake them with breakfast.', mall: 'Shoppers stay for hours. Their cars should leave full.' },
    star3: 'Proud of you, kid.',
    end: "I'm off on vacation. Route 9 is yours!",
    rushSoon: 'Rush hour in 10 seconds! Staff up at the manager.',
    nightSoon: 'Guests wake in 10 seconds. Breakfast rush!',
    saleSoon: 'Flash sale in 10 seconds! Shoppers are coming.',
    bus: 'E-bus! Six hungry riders. Kitchen Rush would help.',
  },
  // Rush summary and bus combo: a rush warns warnSec ahead; a bus served while the player hits busCombo pays busComboMult.
  // A van-rescued driver comes back as a regular and pays regularMult.
  chains: { warnSec: 10, busCombo: 5, busComboMult: 2, flightEvery: 3, valetBoostSec: 15, valetBoost: 2, regularMult: 1.5, ratingAfter: 25 },
  // Station chain: every station keeps its own build and keeps earning; one star at a station opens the next. level sets prices (×1.6ⁿ costs, ×1.3ⁿ income).
  stations: [
    // Each station sells its own food (food: stack model, board text, word in texts), shows its own props (decor), frame colours (floor, wall, trim, fence) and goals.
    { id: 'town', name: 'Greenfield Town', icon: '🏙️', ground: '#6cc070', level: 0, stages: ['coffee', 'depot', 'wash'], note: 'Burgers · coffee · vans · wash',
      food: { model: 'burger', board: 'BURGERS', word: 'burgers', icon: '🍔' }, decor: 'town', extras: { moto: [-5.5, 17.8], mart: [1.8, 17.8], air: [9.5, 17.8] },
      floor: ['#efe6d6', '#d3c3a8'], wall: '#b5523b', trim: '#ffffff', fence: '#ffffff',
      sides: [{ model: 'fries', name: 'Fries', icon: '🍟', price: 3, cost: 160 }, { model: 'sodaGlass', name: 'Soda', icon: '🥤', price: 2, cost: 240 }], machine: '#ff6b3d',
      goals: [{ type: 'cars', goal: 10, reward: 30, text: 'Charge 10 cars' }, { type: 'serve', goal: 15, reward: 40, text: 'Serve 15 burgers' }, { type: 'open:coffee', goal: 1, reward: 60, text: 'Open the coffee drive-thru' },
        { type: 'mobile', goal: 3, reward: 100, text: 'Rescue 3 stranded EVs' }, { type: 'wash', goal: 10, reward: 120, text: 'Wash 10 cars' }, { type: 'rating', goal: 4.8, reward: 150, text: 'Reach a 4.8 rating' }, { type: 'moto', goal: 10, reward: 200, text: 'Charge 10 scooters' }] },
    { id: 'highway', name: 'Highway Rest Stop', icon: '🛣️', ground: '#c8743f', level: 1, stages: ['tire', 'repair', 'tow'], bus: true, rush: true, note: 'Hot dogs · e-buses · rush hour · tires · repair · tow',
      food: { model: 'hotDog', board: 'HOT DOGS', word: 'hot dogs', icon: '🌭', sign: 3.4, tint: { red: '#b8321f', brownLight: '#f2b04a', brown: '#e8962e', yellow: '#ffe14d' } }, decor: 'highway', extras: { mart: [-6, 4.6], air: [-6, 10.4] },
      floor: ['#ece6da', '#cfc6b6'], wall: '#e8792f', trim: '#1d2b3f', fence: '#ffd23f',
      sides: [{ model: 'cup', name: 'Coffee', icon: '☕', price: 3, cost: 160 }, { model: 'sodaCan', name: 'Energy', icon: '⚡', price: 4, cost: 240 }], machine: '#e8792f',
      goals: [{ type: 'bus', goal: 1, reward: 80, text: 'Charge an e-bus' }, { type: 'open:tire', goal: 1, reward: 100, text: 'Open the tire shop' }, { type: 'tow', goal: 3, reward: 200, text: 'Tow 3 broken-down cars' },
        { type: 'rushClean', goal: 1, reward: 250, text: 'Get through a rush hour with no fine' }, { type: 'side1', goal: 30, reward: 200, text: 'Sell 30 energy drinks' }, { type: 'open:tow', goal: 1, reward: 300, text: 'Get the tow truck' }, { type: 'air', goal: 5, reward: 350, text: 'Finish 5 air & glass jobs' }] },
    // VIP limousines come more often here: vip overrides the chance and the gap between VIPs; valet drivers fly off and pay big on return.
    { id: 'airport', name: 'Airport Parking', icon: '✈️', ground: '#a7b3bf', level: 2, stages: ['solar', 'lounge'], vip: { chance: 0.3, gapSec: 30 }, planes: true, valet: true, note: 'Sandwiches · valet · VIP limos · solar · lounge',
      food: { model: 'sandwich', board: 'SANDWICHES', word: 'sandwiches', icon: '🥪', tint: { brownLight: '#e09a45', brown: '#a8582a', brownDark: '#b8453a', green: '#3fae4a' } }, decor: 'airport', extras: { mart: [1.8, 17.8], air: [9.5, 17.8] },
      floor: ['#f2f5f9', '#bccbdc'], wall: '#7fd3ec', trim: '#1f3a6b', fence: '#cfeefa',
      sides: [{ model: 'croissant', name: 'Croissant', icon: '🥐', price: 3, cost: 160 }, { model: 'frappe', name: 'Frappe', icon: '🧋', price: 4, cost: 240 }], machine: '#4dabff',
      goals: [{ type: 'serve', goal: 20, reward: 150, text: 'Serve 20 travelers' }, { type: 'valet', goal: 5, reward: 300, text: 'Return 5 valet cars' }, { type: 'open:solar', goal: 1, reward: 200, text: 'Build the solar field' },
        { type: 'vip', goal: 5, reward: 400, text: 'Treat 5 VIPs' }, { type: 'open:lounge', goal: 1, reward: 400, text: 'Open the VIP lounge' }, { type: 'cars', goal: 60, reward: 500, text: 'Charge 60 cars' }, { type: 'mart', goal: 10, reward: 550, text: 'Sell 10 neck pillows' }] },
    // Seaside hotel: guests leave their cars at the valet overnight and all want breakfast at once in the morning rush.
    { id: 'hotel', name: 'Sunset Bay Hotel', icon: '🏨', ground: '#ecdcae', level: 3, stages: ['wash', 'solar'], valet: true, note: 'Pancakes · overnight valet · breakfast rush · detailing · solar',
      rush: { firstSec: 70, everySec: [150, 180], durSec: 30, waveCars: 3, sky: '#ffc58a', title: 'BREAKFAST RUSH', icon: '🌅', over: 'GOOD MORNING', soon: 'nightSoon', night: 30, darken: 0.35 },
      food: { model: 'pancakes', board: 'PANCAKES', word: 'pancakes', icon: '🥞', tint: { brown: '#b8672a', brownLight: '#eab05a', yellow: '#ffe14d' } }, decor: 'hotel', extras: { moto: [-5.5, 17.8], mart: [1.8, 17.8] },
      floor: ['#f7efe2', '#e2cfae'], wall: '#ff8f7a', trim: '#ffffff', fence: '#9be1d8',
      sides: [{ model: 'cocktail', name: 'Juice', icon: '🍹', price: 3, cost: 160 }, { model: 'iceCreamCone', name: 'Ice Cream', icon: '🍦', price: 4, cost: 240 }], machine: '#ff8f7a',
      goals: [{ type: 'valet', goal: 10, reward: 400, text: 'Return 10 valet cars' }, { type: 'serve', goal: 20, reward: 300, text: 'Serve 20 pancakes' }, { type: 'open:wash', goal: 1, reward: 400, text: 'Open car detailing' },
        { type: 'rushClean', goal: 1, reward: 600, text: 'No fines in a breakfast rush' }, { type: 'wash', goal: 10, reward: 500, text: 'Detail 10 cars' }, { type: 'rating', goal: 4.7, reward: 700, text: 'Reach a 4.7 rating' }, { type: 'mart', goal: 10, reward: 750, text: 'Sell 10 sunscreens' }] },
    // Open-air mall: shoppers stay after charging (stay × charge time) while the idle fee runs, and flash sales bring waves of cars.
    { id: 'mall', name: 'Sunset Plaza', icon: '🛍️', ground: '#d9cfc2', level: 4, stages: ['coffee', 'wash', 'solar'], stay: 0.5, note: 'Pizza · long-stay shoppers · flash sales · coffee · hand wash · solar',
      rush: { firstSec: 80, everySec: [180, 240], durSec: 40, waveCars: 3, sky: '#ffb3d1', title: 'FLASH SALE', icon: '🛍️', over: 'SALE OVER', soon: 'saleSoon' },
      food: { model: 'pizza', board: 'PIZZA', word: 'pizzas', icon: '🍕' }, decor: 'mall', extras: { moto: [-5.5, 17.8], air: [9.5, 17.8] },
      floor: ['#f3eee6', '#d6c9b5'], wall: '#8a6cff', trim: '#ffffff', fence: '#ffd23f',
      sides: [{ model: 'donutSprinkles', name: 'Donut', icon: '🍩', price: 3, cost: 160 }, { model: 'waffle', name: 'Waffle', icon: '🧇', price: 4, cost: 240 }], machine: '#8a6cff',
      goals: [{ type: 'cars', goal: 15, reward: 500, text: 'Charge 15 cars' }, { type: 'serve', goal: 25, reward: 500, text: 'Serve 25 pizzas' }, { type: 'open:coffee', goal: 1, reward: 600, text: 'Open the coffee kiosk' },
        { type: 'rushClean', goal: 1, reward: 800, text: 'No fines in a flash sale' }, { type: 'wash', goal: 10, reward: 700, text: 'Wash 10 cars' }, { type: 'rating', goal: 4.7, reward: 900, text: 'Reach a 4.7 rating' }, { type: 'moto', goal: 10, reward: 900, text: 'Charge 10 scooters' }] },
  ],
  // Stars: one when every stage is open, two when every upgrade is maxed, three after topSec at a rating of topRating or more; each star adds starBonus income everywhere.
  // A new station tops the wallet up to grant × 1.6^level if it holds less.
  chain: { starBonus: 0.05, topRating: 4.6, topSec: 600, grant: 300, travelMs: 2400, arriveMs: 900 },
  // Airport stages: a solar field that raises every charge fee by step per Solar Panels level, and a VIP lounge whose upgrades bring VIPs
  // gapStep seconds sooner and add billStep bills to their trail. The tower and runway stand beside the airport lot; planes start their descent at planeY.
  airport: {
    solar: { cost: 1200, padAt: [-6, 11], at: [-3.5, 11], step: 0.08, upgrades: { solarPanels: { name: 'Solar Panels', baseCost: 260, maxLevel: 3 }, solarStorage: { name: 'Battery Bank', baseCost: 320, maxLevel: 2, step: 0.05 } } },
    lounge: { cost: 1800, padAt: [-6, 4.6], at: [-6, 4.6], upgrades: { vipInvites: { name: 'VIP Invites', baseCost: 300, maxLevel: 3, gapStep: 6 }, redCarpet: { name: 'Red Carpet', baseCost: 340, maxLevel: 3, billStep: 1 } } },
    // The plane is drawn at planeScale; its landing shot pulls the camera back by planeZoom so the whole plane fits.
    planeY: 9, tower: [-9.5, -15.5], planeScale: 1.1, planeZoom: 1.35,
    // A flight lands every landEverySec: the camera looks at the runway beside the lot, then landWave cars come in.
    landEverySec: [70, 100], landSec: 3.5, runway: [-16, -24], landWave: 2,
    // Valet: valetShare of drivers leave the car, walk to the terminal and fly; they return after valetSec and pay feeMult times the fee.
    valet: { share: 0.3, sec: 30, feeMult: 4, terminal: [-12, -6] },
  },
  // Camera director: big moments pull the camera there for a short look, then it glides back to the player.
  director: { buildSec: 1.6, vipSec: 1.3, policeSec: 3.2, glide: 4, backSec: 0.8, lookZoom: 0.8 },
  // The camera starts close on a small station and pulls back as it grows: zoom = start + perBay × extra bays + office, up to max.
  growZoom: { start: 0.82, perBay: 0.05, office: 0.07, later: 0.08, max: 1.1, rate: 1.5, viewBelow: 0.8 },
  // VIP arrival: a red carpet unrolls from the car to the table, cameras flash along it.
  vipShow: { carpetW: 0.7, widthPerLevel: 0.15, unrollSec: 0.6, flashEvery: 0.35 },
  // E-bus at stations with bus: true, once two bays are open: when one is due, two neighbouring bays stop taking cars until both are free,
  // then the bus parks across them, charges chargeMult times longer and pays feeMult times the fee.
  // A hold is dropped when the queue nears a jam and retried after retrySec.
  bus: { firstSec: 40, everySec: [50, 80], retrySec: 15, chargeMult: 3, feeMult: 5 },
  // Rush hour at stations with rush: true, once stage 1 is done: every everySec a wave of waveCars joins the queue, cars come spawnFactor times as often,
  // burgers pay mealMult, the police stay away, and the sky turns to sunset.
  // A station can override any rush field: its banner title and icon, the summary title, Rosa's warning line (soon), and night seconds of
  // darkness (darken share of the light) before the rush, when guests leave their cars at the valet.
  rush: { firstSec: 90, everySec: [240, 300], durSec: 45, spawnFactor: 0.6, mealMult: 2, waveCars: 2, sky: '#ffb070', title: 'RUSH HOUR', icon: '🌇', over: 'RUSH OVER', soon: 'rushSoon', night: 0, darken: 0, nightSky: '#5f6fb0' },
  // KayKit car models customers drive (CC0, Kay Lousberg); VIPs arrive in the station wagon.
  kit: { cars: ['car_sedan', 'car_hatchback', 'car_taxi', 'car_stationwagon'], vip: 'car_stationwagon' },
  // Mobile charging after Station 1: a depot pad, vans dispatched from a mini map, fee = base + per km, travel cost per km.
  // Grounded in AAA's 2011 roadside charging truck, SparkCharge Currently vans and OtoPriz mobile charging in Istanbul (docs/REAL_WORLD.md).
  mobile: {
    pad: { type: 'depot' },
    depotCost: 300,
    padAt: [-6, 11],
    depotAt: [-6, 11], depotTurn: Math.PI / 2,
    cashAt: [1.6, 11],
    cashZone: [3, 1.4],
    vanSlots: [[-2.8, 9.5], [-2.8, 11], [-2.8, 12.5]], vanTurn: Math.PI / 2,
    // Lot routes for vans: out of the slot onto the road and away, and back in; null x is the van's own slot.
    exitRoute: [[-0.6, null], [-0.6, 7.6], [14.9, 7.6], [14.9, 40]], returnRoute: [[16.3, 40], [16.3, 9.4], [0.8, 9.4], [0.8, null], [null, null]], lotSpeed: 9, tagHeight: 2.6,
    minKm: 1,
    maxKm: 8,
    callEverySec: [8, 14],
    maxCalls: 3,
    callPatienceSec: 30,
    feeBase: 15,
    feePerKm: 4,
    costPerKm: 1,
    vanKmPerSec: 0.5,
    onSiteSec: 5,
    jobsPerCharge: 3,
    rechargeSec: 20,
    tapKm: 1.2,
    upgrades: {
      vans: { name: 'More Vans', baseCost: 200, maxLevel: 2 },
      vanSpeed: { name: 'Faster Vans', baseCost: 120, maxLevel: 4, factor: 1.25 },
      vanBattery: { name: 'Bigger Van Battery', baseCost: 150, maxLevel: 3, step: 1 },
      dispatcher: { name: 'Auto Dispatch', baseCost: 400, maxLevel: 1 },
    },
    map: { ground: '#2b5d3a', road: '#9aa7b4', ring: 'rgba(255,255,255,0.18)', station: '#2fe39b', call: '#ff4d6d', van: '#4dabff', text: '#ffffff', ringsKm: [2, 5], pulse: 6 },
  },
  // Car wash after mobile charging: a share of charged cars turn left on the exit lane and drive through the tunnel.
  // Grounded in stations with washes earning 23-38% more (NACS) and Car Wash Empire's speed, price and popularity lines.
  wash: {
    padAt: [-6, 4.6],
    cashAt: [-3.6, 4.6], cashZone: [2.2, 1.6],
    price: 8,
    share: 0.3,
    lineMax: 3,
    washSec: 4,
    // Lane x of the tunnel; cars enter at the top, stop in the middle and leave at the bottom onto the van street.
    // The last car in line waits entryGap along the exit lane from the corner, more than the longest car, so it never noses into the one ahead.
    laneX: -6, enterZ: 2.4, stopZ: 4.6, leaveZ: 7.6, entryGap: 4.4,
    upgrades: {
      washSpeed: { name: 'Wash Speed', baseCost: 140, maxLevel: 3, factor: 0.8 },
      washPrice: { name: 'Wash Price', baseCost: 160, maxLevel: 3 },
      washPopularity: { name: 'Popularity', baseCost: 150, maxLevel: 3, step: 0.1 },
    },
  },
  // From the second city on: tire shop, repair garage and tow truck on a new bottom strip, as stages 5 to 7.
  // Tire and repair customers come off the road onto the strip's top street (right to left), drive through their bay and leave by the
  // bottom street (left to right). The tow truck fetches broken-down cars and drops them at the garage.
  service: {
    // Full service: this share of repaired cars also go to the tire bay, and that tire job pays fullMult.
    fullShare: 0.5, fullMult: 1.5,
    streetZ: 15, backZ: 20.6, turnX: -8.6,
    tire: { cost: 600, padAt: [-5.5, 16.6], bayAt: [-5.5, 17.8], zone: [-3.6, 17.8], zoneSize: [1.6, 2.4], cashAt: [-3.6, 18.9], price: 10, jobSec: 2, fitterSec: 3.5, everySec: [9, 15], label: '🛞' },
    repair: { cost: 960, padAt: [1.8, 16.6], lifts: [[0.5, 17.9], [3.1, 17.9]], cashAt: [5.1, 18.9], price: 20, jobSec: 9, everySec: [14, 22], liftY: 0.7, label: '🔧' },
    tow: { cost: 1500, padAt: [9.5, 16.6], depotAt: [9.5, 18.2], cashAt: [11, 18.9], fee: 15, kmPerSec: 1.6, km: [1, 4], callEverySec: [20, 30], callPatienceSec: 40, hook: [0, -2.3] },
    cashZone: [2, 1.4],
    upgrades: {
      tire: {
        tireSpeed: { name: 'Air Wrench', baseCost: 180, maxLevel: 3, factor: 0.75 },
        tirePrice: { name: 'Tire Price', baseCost: 200, maxLevel: 3 },
        tireFitter: { name: 'Hire Tire Fitter', baseCost: 260, maxLevel: 1 },
      },
      repair: {
        repairSpeed: { name: 'Better Tools', baseCost: 280, maxLevel: 3, factor: 0.8 },
        repairPrice: { name: 'Repair Price', baseCost: 300, maxLevel: 3 },
        secondLift: { name: 'Second Lift', baseCost: 420, maxLevel: 1 },
      },
      tow: {
        towTrucks: { name: 'Second Tow Truck', baseCost: 500, maxLevel: 1 },
        towSpeed: { name: 'Faster Tow', baseCost: 380, maxLevel: 3, factor: 1.25 },
        towFee: { name: 'Tow Fee', baseCost: 400, maxLevel: 3 },
      },
    },
  },
  // Mini missions run one at a time and loop with bigger goals and rewards each cycle.
  missions: {
    list: [
      { type: 'serve', goal: 6, reward: 20, text: 'Serve {n} {food}' },
      { type: 'plug', goal: 4, reward: 20, text: 'Plug in {n} cars yourself' },
      { type: 'cars', goal: 8, reward: 30, text: 'Charge {n} cars' },
      { type: 'combo', goal: 3, reward: 30, text: 'Reach a x{n} combo' },
      { type: 'vip', goal: 1, reward: 40, text: 'Treat {n} VIP driver' },
      { type: 'serve', goal: 15, reward: 50, text: 'Serve {n} {food}' },
    ],
    goalScale: 1.5,
    rewardScale: 1.3,
  },
  // Daily return bonus, and `pick` tasks a day drawn from `tasks` by the date; each pays `fees` charge fees when done.
  daily: { base: 20, maxDays: 7, pick: 3, tasks: [
    { kind: 'cars', goal: 15, fees: 4, text: 'Charge 15 cars' },
    { kind: 'serve', goal: 12, fees: 4, text: 'Serve 12 meals' },
    { kind: 'sides', goal: 6, fees: 5, text: 'Sell 6 sides' },
    { kind: 'vip', goal: 1, fees: 5, text: 'Serve a VIP' },
    { kind: 'rival', goal: 1, fees: 6, text: 'Beat VoltMart' },
    { kind: 'regular', goal: 2, fees: 4, text: 'Welcome 2 regulars' },
  ] },
  // Storm: from firstSec, every everySec, a storm of `sec`: rain, dim light and lightning; drivers rush in (one more every carEverySec)
  // and each pays feeMult; the police hold off.
  storm: { firstSec: 420, everySec: [540, 720], sec: 35, carEverySec: 7, feeMult: 1.5, dim: 0.4, rain: 500, flashSec: [5, 9] },
  // Blackout: from firstSec, every everySec, the chargers go dark and stop charging until the owner stands on the generator for
  // holdSec; it appears `away` units from the owner. Restoring pays fixFees charge fees; after autoSec the power comes back anyway.
  blackout: { firstSec: 360, everySec: [480, 600], holdSec: 1.2, away: 3, fixFees: 3, autoSec: 30 },
  // Weekend Car Fest: on Saturdays and Sundays every car pays `mult`.
  fest: { mult: 1.25, days: [0, 6] },
  // Winter lights hang over the lot in these months (0 = January).
  winterMonths: [11, 0],
  // Owner outfits: the first is free, each car in the album unlocks the next.
  outfits: ['#ff6b3d', '#4dabff', '#2fe39b', '#e86bd1', '#ffd34d', '#8a6cff'],
  // Golden car: a rare ordinary car painted gold that sparkles and pays feeMult.
  golden: { chance: 0.025, feeMult: 5, color: '#ffc93d' },
  // Road-trip convoy: from firstSec, every everySec a group of `cars` arrives at once; each pays feeMult and the police hold off.
  convoy: { firstSec: 300, everySec: [360, 480], cars: 4, feeMult: 2 },
  // Regulars: `chance` of ordinary drivers are one of these people; they pay as regulars, say their line, and on every giftEvery-th
  // visit leave a gift worth giftFees charge fees.
  regulars: { chance: 0.12, giftEvery: 5, giftFees: 5, people: [
    { name: 'Mehmet', icon: '🚕', line: 'The usual, full charge!' },
    { name: 'Ayla', icon: '📦', line: 'Twelve deliveries left today!' },
    { name: 'Grandpa Joe', icon: '👴', line: 'This old van still runs!' },
    { name: 'Lina', icon: '🎸', line: 'Gig in an hour, hurry!' },
    { name: 'Dr. Kaya', icon: '🩺', line: 'On call, quick top-up please' },
    { name: 'The Newlyweds', icon: '💐', line: 'Honeymoon road trip!' },
  ] },
  // Car album: the first time each model is served it goes in the album and pays firstFees charge fees; a full album pays fullFees.
  album: { firstFees: 3, fullFees: 40 },
  // VoltMart, the rival chain: from firstSec of play, every everySec a VoltMart van pulls onto the lot-side shoulder level with the owner and poaches
  // drivers. Serving `need` cars within challengeSec sends it away and pays winFees charge fees; after giveUp wins at a station
  // VoltMart gives up on it and pays giveUpFees. A lost round costs nothing but the round.
  rival: { firstSec: 150, everySec: [200, 260], challengeSec: 30, need: 3, winFees: 6, giveUp: 3, giveUpFees: 25 },
  decorAt: [0.15, 0.35, 0.55, 0.75, 0.95],
  engage: {
    comboWindow: 4,
    comboMax: 5,
    comboBonus: 0.2,
    comboPitch: 0.12,
    vipFirstCar: 4,
    vipChance: 0.15,
    // A VIP pays vipFeeMult × the charge fee and, walking back to the car, drops vipBills bills worth vipBillShare × fee each.
    vip: { gapSec: 60, feeMult: 3, bills: 5, billShare: 0.4, lifeSec: 25, pickRadius: 1, ring: '#ffd34d' },
    ratingStart: 5,
    ratingWindow: 10,
    ratingFastShare: 0.5,
    ratingScores: { fast: 5, fed: 4, left: 3, hungry: 2 },
    ratingSlowdown: 0.5,
    shakeSec: 0.35,
    shakeAmp: 0.25,
    bigBurst: 2,
    bannerMs: 1800,
  },
  feel: {
    ringGrow: 0.08,
    payPopSec: 1,
    payPopRise: 1.2,
    flySec: 0.25,
    flyArc: 1.2,
    cashStagger: 0.04,
    countRate: 12,
    bumpMs: 160,
    bumpScale: 1.15,
    leanMax: 0.3,
    leanRate: 8,
    popSec: 0.35,
    popOvershoot: 1.7,
    stepRate: 11, carryArms: -1.1,
    stepSwing: 0.6,
    toastMs: 2600,
    stageUpMs: 3000,
    toastQueue: 1,
    toastGapMs: 400,
    maxFloats: 4,
    popInShare: 0.15,
    popPeak: 1.6,
    maxCoins: 8,
    coinMs: 650,
    coinStaggerMs: 45,
    deltaGapSec: 0.3,
    deltaMs: 1100,
  },
  world: {
    // The lot grows top to bottom: [from z, to z, unlock] strips; the office strip and the depot strip are paved when bought.
    floorWidth: 23.8, floorX: 1.9,
    floorParts: [[-16.6, 1.9, null], [1.9, 8.2, 'office'], [8.2, 14.4, 'depot'], [14.4, 22, 'tire']], reach: 2.4, edge: 0.3,
    floorTile: 2,
    // Soft paved lanes cars follow: entry along the top, exit under the bays, the drive-thru back street and the van street.
    // Lane look: mix is how far strip and dash colours sit from the floor toward lane/laneLine, dash is [length, width], step the dash spacing.
    laneLook: { mix: 0.45, dash: [0.4, 0.06], step: 1.6 },
    lanes: [
      { at: [[12.4, -42], [12.4, -16.6]], w: 1.8, when: 'coffee', road: true },
      { at: [[12.4, -16.6], [12.4, 2.6]], w: 1.6 },
      { at: [[12.4, -8], [0.8, -8]], w: 1.6 },
      { at: [[0.8, 1], [12.4, 1]], w: 1.6 },
      { at: [[-0.6, 12.6], [-0.6, 7.6], [13.6, 7.6]], w: 1.6, when: 'depot' },
      { at: [[0.8, 1], [-6, 1], [-6, 7.6], [-0.6, 7.6]], w: 1.6, when: 'wash' },
      { at: [[12.4, 2.6], [12.4, 15], [-8.6, 15], [-8.6, 20.6], [13.6, 20.6]], w: 1.6, when: 'tire' },
    ],
    // Zebra crossings where the player's walking line crosses a lane.
    crossings: [[[5.25, 1], null], [[-0.2, -8], null], [[5.25, 7.6], 'depot']],
    entryZ: -8,
    exitZ: 1,
    // Where the service lane merges back onto the road below the lot.
    merge: [[12.4, 2.6], [14.9, 4.6]],
    // The restaurant's back wall runs only behind the kitchen row, from x to x.
    kitchenWall: [-7.4, 3.4],
    patio: { at: [-5, -4.6], size: [6.4, 8.4], repeat: [3, 4] },
    bayNumberZ: -6.4,
    streetLights: [-9, 0, 9, 18], streetLightX: 13.9,
    cityBlocks: [['building_C', 21.5, -12], ['building_A', 21.5, -5], ['building_E', 21.5, 2], ['building_D', 21.5, 9], ['building_B', 21.5, 16], ['building_C', 21.5, 23]],
    // [kit model, scale, x, z, turn] inside each office.
    bounds: [-9.5, 11.6, -15.6, 21.6],
    playerSpawn: [-1.5, -6],
    cafe: [-4.6, -11.8],
    // Chargers stand beside their bay; cars park nose down with the plug on the driver's side.
    bays: [[0.45, -4], [3.45, -4], [6.45, -4], [9.45, -4]],
    carOffset: [1.05, 0.4],
    // Drivers' walkway: this far above the bays' row, clear of the parked cars.
    aisle: 2.7,
    cashOffset: [0, 1.6],
    workerPad: [-1.2, -0.6],
    tables: [[-6.5, -7], [-3.5, -7], [-6.5, -3], [-3.5, -3]],
    cameraOffset: [0, 28.9, 24.2],
    // The camera follows the player sideways too, so the lot can be wider than the screen.
    cameraX: [-5, 7.5],
    // Walking right, the camera slides on until the road and the district across it, up to this x, are on screen.
    viewRight: 24,
    // Walking left, the camera slides on until the scenery out to this x is on screen.
    viewLeft: -22,
    // Within `band` of the lot's left, right or top edge the camera pulls back by up to `zoom` to show the district around it; the player stays `keep` inside the screen
    // and may drift out to `box` of the screen (instead of keepPlayer's middle box) so the view leans out over the scenery.
    edgeView: { band: 3, zoom: 0, keep: 2.5, box: 0.55 },
    cameraZ: [-12, 16],
  },
  sizes: {
    meal: { kit: 0.7, h: 0.6, gap: 0.8, cols: 3 },
    tableTop: 0.8,
    table: { zone: [2.2, 1.9], seat: [0.85, 0], cash: [-0.9, 0], door: [-0.85, 0] },
    bill: [0.65, 0.07, 0.4],
    carRoof: 1.3,
    pad: [2.6, 0.06, 2.6],
    // touch: how far past a bay's painted area the owner may stand (at the parked car's side) and still plug in or take its cash.
    zones: { cafe: { offset: [0, 0], size: [3.2, 2.8] }, bay: { offset: [0.7, 0.4], size: [2, 4], touch: 0.5 }, opacity: 0.35, lift: 0.01 },
    arrow: { r: 0.3, h: 0.6, height: 2.6, bob: 0.25 },
    // The stack rides on the back, where the camera from above sees it; in the own-eye view it moves to the hands in front (eyeView.carryZ).
    carryBase: [0, 0.6, -0.45],
    tagHeight: 2.8,
    labelScale: 0.9,
    carInk: 1.03,
    real: REAL,
    inkScale: 1.08,
    markHeight: 2.25,
  },
  // Sharpness: up to maxPixelRatio at 30 fps; a slow phone steps down to minPixelRatio and climbs back after upSec above upFps.
  // Framing for any screen: the camera shows at least minW × minH world units and never more than unitPx CSS pixels per unit,
  // so phones in either orientation see the play area and tablets see more of the world at the same character size.
  frame: { minW: 12, minH: 17, unitPx: 32 },
  // The player always stays inside this middle box of the screen (half-width and half-height in screen units, 1 is the edge).
  keepPlayer: { x: 0.25, y: 0.25 },
  // A stage pad near the player is always framed whole: the camera pulls back around the player, at most maxZoom, until all four
  // corners sit inside the screen clear of the HUD (safe margins in CSS px: top bar, bottom buttons, sides).
  padFrame: { near: 7, lead: 2, margin: 0.3, safe: { top: 120, bottom: 72, side: 12 }, maxZoom: 1.5, rate: 4, speed: 0.6 },
  // Anything between the camera and the owner fades to `opacity` while it is in the way; checked every `every` frames at three heights.
  // Eye view after standing still: the camera at height, back metres behind the owner looking look metres ahead at lookY with a wide
  // fov; wallGap keeps it in front of anything solid behind them.
  eyeView: { afterSec: 3, height: 4.4, back: 5.6, side: 1.1, carryZ: 0.5, look: 10, lookY: 0.6, fov: 60, wallGap: 0.3, climb: 1, inSec: 1.2, outSec: 0.6 },
  // Markers in front of the owner: rays every n frames at these heights and spread to the owner's sides find them (whole objects up
  // to maxSize, kept for holdSec) and fade them to opacity; the ghost is the owner's own see-through copy behind anything tall.
  fade: { opacity: 0.28, every: 2, heights: [0.4, 1.2, 2], maxSize: 7, holdSec: 0.5, ghost: 0.6, spread: 0.25 },
  render: { fov: 35, near: 0.1, far: 200, maxPixelRatio: 1.75, minPixelRatio: 1.25, upFps: 27, upSec: 10, maxFps: 30, shadowEvery: 3, hemi: 0.95, sun: 1.5, sunPos: [-8, 18, 10], shadowMap: 1024, shadowExtent: 16, shadowBias: -0.0004, toonSteps: [110, 190, 255], minFps: 22, qualityWindowSec: 2, pixelRatioStep: 0.25,
    // Settings resolution: a fixed pixel ratio (capped by the screen) or null for automatic steps by frame rate.
    quality: { Auto: null, High: 2, Max: 3 }, qualityDefault: 'High' },
  label: { w: 256, h: 96, font: 'bold 64px "Baloo 2", sans-serif', stroke: 10, gauge: [8, 22, 96, 52], gaugeLow: 0.25, gaugeMid: 0.6, gaugeMin: 0.04 },
  // tapSlop: most a finger may move for a press to count as a tap (pixels).
  // dead and full are shares of the radius: no movement inside dead, full speed from full on.
  joystick: { radius: 50, tapSlop: 12, dead: 0.12, full: 0.5 },
  // One versioned object holds the whole run; the key stays the same across versions so old saves migrate in place.
  // A copy of the save goes to `<key>-backup` every backupSec of play, never over a copy with more play in it; on start, a copy at
  // least restoreGapSec ahead of the save is offered back.
  // Where a shared station points friends to.
  shareUrl: 'https://charge-ready.pages.dev',
  save: { key: 'charge-ready-v2', version: 5, intervalMs: 5000, backupSec: 60, restoreGapSec: 120 },
  // A player who earns nothing for stallSec while cars wait gets one hint toward Settings → Unstuck.
  rescue: { stallSec: 90 },
  // Few, soft, distinct sounds: prio decides which one plays when two would overlap, cool is the minimum gap per sound.
  sfx: {
    volume: 0.24,
    floor: 0.0001,
    sounds: {
      plug: { notes: [520, 780], wave: 'triangle', dur: 0.07, gap: 0.05, prio: 1, cool: 0.4 },
      deliver: { notes: [660], wave: 'triangle', dur: 0.06, gap: 0, prio: 1, cool: 0.25 },
      pickup: { notes: [440], wave: 'sine', dur: 0.05, gap: 0, prio: 1, cool: 0.1 },
      talk: { notes: [520, 600], wave: 'triangle', dur: 0.06, gap: 0.07, prio: 1, cool: 1 },
      tool: { notes: [300, 420, 300], wave: 'square', dur: 0.04, gap: 0.05, prio: 1, cool: 0.35 },
      cash: { notes: [1319, 1760], wave: 'triangle', dur: 0.12, gap: 0.06, prio: 2, cool: 0.3 },
      horn: { notes: [330, 330], wave: 'square', dur: 0.12, gap: 0.05, prio: 3, cool: 5 },
      vip: { notes: [1568, 2093], wave: 'sine', dur: 0.08, gap: 0.06, prio: 2, cool: 1 },
      buy: { notes: [523, 659, 784], wave: 'triangle', dur: 0.1, gap: 0.07, prio: 2, cool: 0.3 },
      alert: { notes: [880, 660], wave: 'triangle', dur: 0.14, gap: 0.12, prio: 3, cool: 2 },
      siren: { notes: [960, 770, 960], wave: 'triangle', dur: 0.16, gap: 0.16, prio: 3, cool: 5 },
      fine: { notes: [523, 392, 262], wave: 'triangle', dur: 0.2, gap: 0.16, prio: 3, cool: 1 },
      complete: { notes: [523, 659, 784, 1046], wave: 'triangle', dur: 0.22, gap: 0.11, prio: 3, cool: 1 },
    },
  },
  // Particle presets: count per emit, speeds, gravity, lifetime, size; `every` is the mean gap for continuous effects.
  fx: {
    max: 600,
    spriteScale: 2.2,
    confetti: { count: 24, speed: 5, up: 6, gravity: 14, life: 0.9, size: 0.14, colors: ['#ffd34d', '#2fe39b', '#ff6b3d', '#4dabff'] },
    flash: { count: 8, speed: 3, up: 1, gravity: 0, life: 0.18, size: 0.24, every: 1, colors: ['#ffffff', '#fff6c8'] },
    spark: { count: 2, speed: 1, up: 3, gravity: 8, life: 0.4, size: 0.08, every: 0.25, colors: ['#fff3a0', '#2fe39b'] },
    gold: { count: 10, speed: 2.5, up: 4, gravity: 10, life: 0.5, size: 0.1, colors: ['#ffd34d', '#fff1a0'] },
    trail: { count: 1, speed: 0.3, up: 0.5, gravity: 0, life: 0.5, size: 0.16, every: 0.06, minCombo: 3, colors: ['#ffd34d', '#ff6b3d', '#e86bd1'] },
    foam: { count: 3, speed: 1.2, up: 2, gravity: 2, life: 0.8, size: 0.16, every: 0.08, colors: ['#ffffff', '#bfe8ff', '#ff9fd0'] },
    vip: { count: 2, speed: 0.8, up: 1.5, gravity: 0, life: 0.7, size: 0.09, every: 0.3, colors: ['#ffcc33', '#fff6c8'] },
    heart: { count: 14, speed: 3, up: 5, gravity: 10, life: 0.8, size: 0.14, colors: ['#ff4d6d', '#ff8fab'] },
    steam: { count: 1, speed: 0.15, up: 0.8, gravity: 0, life: 1.2, size: 0.12, every: 0.4, colors: ['#ffffff'] },
    fine: { count: 22, speed: 4, up: 6, gravity: 12, life: 1, size: 0.16, colors: ['#ff2d55', '#1f4fd1', '#ffffff'] },
    ring: { inner: 1.35, outer: 1.6, pulse: 6, color: '#ffd34d' },
  },
  vibrateMs: 30,
  colors: {
    sky: '#6cc070', floor: ['#e6e0d6', '#d3cbbd'], patio: ['#f6e6c8', '#e9b98a'],
    bun: '#e0a24a', bunTop: '#c77d2e', sausage: '#c4492f', mustard: '#ffd23f', bread: '#f2d39b', lettuce: '#6cc04a', cheese: '#ffc93c', guardrail: '#c3ccd6', sign: '#1f7a4d', truck: '#e8792f', shuttle: '#4dabff', luggage: '#7a5cff', umbrella: '#ff6b3d', vip: '#ffcc33', drivers: ['#4dabff', '#5ee1a0', '#e86bd1', '#9aa5b1', '#b07d5a'], hair: '#3a2a20', apron: '#ffffff', badge: '#ffd34d', counter: '#c98a55', cable: '#14233a',
    tire: '#20242c', headlight: '#fff1a0', curb: '#c3ccd6', washWall: '#2f8fd8', tire: '#23262d', rim: '#c3ccd6', tireShop: '#e8792f', garage: '#3f78d1', lift: '#ffcf33', busBody: '#f4f6f8', panel: '#2a4f8f', panelLine: '#9cc4ff', gold: '#e2b23a', carpet: '#d4334a', limo: { body: '#16181f', glass: '#2c4058', trim: '#c9d2dc', stripe: '#f2c14e' }, tow: '#ffb300', washFloor: '#8fb6cf', washBrush: '#ff5fa2', bubble: '#bfe8ff', lane: '#d9cfbe', laneLine: '#fffaf0', screenOff: '#5b6b80', rackDark: '#1f4fd1', pants: '#2a3446',
    gaugeLow: '#ff4d6d', gaugeMid: '#ffd34d', gaugeHigh: '#2fe39b', signBoard: '#14233a', sidewalk: '#d9d4c7',
    trunk: '#8a5a3b', leaf: '#3fae6a', leafLight: '#56c47c', grass: '#6cc070', road: '#3d4452', roadLine: '#f4f1e6',
    paint: '#ffffff', wall: '#fff7ea', pole: '#5b6b80', rack: '#2f6bff', battery: '#2fe39b', charger: '#1d2b3f',
    pad: '#ffd34d', zoneCafe: '#ff9a3d', zoneTable: '#ffd34d', zoneBay: '#2fe39b', player: '#ff6b3d', worker: '#7a5cff', vanBody: '#18b87a', roof: '#5b6478', solar: '#2a4f8f', manager: '#1f3a6b', accountant: '#2f9e6b', temp: '#2fbfbf', police: '#1f4fd1', siren: '#ff2d55', rival: '#5d7fa8', rivalSign: '#2fd2ff', cupBody: '#f4f1e6', cupLid: '#6b4226', jam: '#ff4d6d', gain: '#5dff7a', loss: '#ff4d6d', action: '#4dd6ff', skin: '#ffd2b0', cheek: '#ff9a9a', glass: '#203040', purple: '#8a6cff', sea: '#3a9fd1', mesa: ['#c4693f', '#de9259', '#a9532f', '#e8a86b'], floorWood: '#e8c99a', rug: '#f4e9d8', sofa: '#ff8f7a',
    bill: '#f2c230', billInk: '#9a6a00', arrow: '#ffb800', labelText: '#ffffff', labelStroke: '#14233a',
    lightSky: '#cfe8ff', lightGround: '#b49a7a', sun: '#fff2dc',
  },
};
