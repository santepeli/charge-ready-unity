# ECONOMY_L1: Seviye 1 ekonomi tablosu

Sabit referans, salt okunur. Değerler `config.js` ile birebir aynıdır. `npm run check` bu dosyadaki tabloları formüllerle karşılaştırır.

## Formüller

- Upgrade maliyeti: `round(taban × 1,6^n)`. n, o upgrade hattının mevcut seviyesidir (0'dan başlar). Her satın almada n bir artar.
- Şarj ücreti: `round(6 × 1,3^t)`. t, Prices seviyesidir (eski adı Charging Price). Burger: `round(4 × 1,3^t)`, combo bonusu ayrıca. Araç şarjı bitip ayrılırken öder.
- Yemek: 3, sabit. Kablo takılınca sürücü araçtan iner, masasına yürür ve 2 burger ister; her teslim anında masaya ödenir. 10 sn içinde servis yoksa sürücü aç kalkar, satış kaybolur. Yemek 3 sn sürer.
- Bekleme ücreti: şarj bittikten 1 sn sonra, sürücü araca dönene kadar saniyede 1. Araç ayrılırken şarj ücretiyle birlikte ödenir (gerçek örnek: Tesla, Electrify America).
- Tepsi kapasitesi: `3 + n` burger (Bigger Tray).
- Şarj süresi: `6 × 0,85^n` oyun saniyesi (Fast Chargers). Gerçekteki 20-30 dakikalık hızlı şarjın oyun karşılığıdır.
- Yeni şarj noktası: `round(50 × 1,6^(k−2))`. k, açılan noktanın sırasıdır. 1. nokta ücretsiz.
- İşçi: 180, sabit.
- Offline kazanç: `floor(min(geçen sn, 7200) × saniyelik gelir × 0,5)`. Saniyelik gelir istasyonun son ölçülen gerçek geliridir (muhasebe penceresi, görev ve bonus hariç). Ölçüm yoksa `açık nokta × şarj ücreti / 60` kullanılır; aşağıdaki örnekler bu yedek tahmine göredir.

## Sabitler

| Ad | Değer |
|---|---|
| Başlangıç parası | 0 |
| Sürücü başına sipariş | 2 burger |
| Mutfak tezgâhı kapasitesi | 8 |
| Burger hazırlama | 1,2 sn |
| Sürücü sabrı | 10 sn |
| Yemek süresi | 3 sn |
| Bekleme ücreti | 1 sn tolerans, sonra 1/sn |
| Kablo takma | 0,3 sn |
| İşçi tepsi kapasitesi | 3 |
| Boşalan noktaya yeni araç | 1 sn + yoldan geliş |
| Offline tavan | 7200 sn (2 saat) |

## Upgrade hatları

Maliyet sütunu, o seviyeden bir sonrakine geçiş bedelidir. Her hat en fazla 5 seviye.

<!-- check: upgrades -->
| Seviye | Charging Price maliyeti | Şarj ücreti | Bigger Tray maliyeti | Tepsi kapasitesi | Fast Chargers maliyeti | Şarj süresi (sn) |
|---|---|---|---|---|---|---|
| 0 | 30 | 6 | 25 | 3 | 35 | 6.000 |
| 1 | 48 | 8 | 40 | 4 | 56 | 5.100 |
| 2 | 77 | 10 | 64 | 5 | 90 | 4.335 |
| 3 | 123 | 13 | 102 | 6 | 143 | 3.685 |
| 4 | 197 | 17 | 164 | 7 | 229 | 3.132 |
| 5 | MAX | 22 | MAX | 8 | MAX | 2.662 |

## Açılış pad'leri

Pad'ler sırayla ve tek tek görünür.

<!-- check: pads -->
| Sıra | Tür | Maliyet | Açılan |
|---|---|---|---|
| 1 | bay | 50 | 2. şarj noktası |
| 2 | bay | 80 | 3. şarj noktası |
| 3 | worker | 180 | İşçi (kablo takar, masalara servis eder) |
| 4 | office | 150 | Müdür odası (kaytaran işçiyi uyarır, eksik bildirilince takviye alır) |
| 5 | accounting | 100 | Muhasebe ofisi (gelir-gider defteri, takviye kârlılık kontrolü) |
| 6 | bay | 128 | 4. şarj noktası |

## Seviye toplam maliyeti

<!-- check: total -->
| Kalem | Maliyet |
|---|---|
| Pad'ler | 688 |
| Charging Price | 475 |
| Bigger Tray | 395 |
| Fast Chargers | 553 |
| Toplam | 2111 |

## Offline kazanç örnekleri

<!-- check: offline -->
| Açık nokta | Tarife | Geçen süre (sn) | Kazanç |
|---|---|---|---|
| 1 | 0 | 3600 | 180 |
| 1 | 0 | 7200 | 360 |
| 2 | 1 | 7200 | 960 |
| 3 | 2 | 1800 | 450 |
| 4 | 5 | 36000 | 5280 |
