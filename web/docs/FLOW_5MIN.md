# FLOW_5MIN: İlk 5 dakika akışı

Sabit referans, salt okunur. Süreler oyun süresidir ve `npm run playtest` insan profiliyle ölçülür (2026-11-05: ilk araç 0:14, nokta 2 0:51, nokta 3 1:37, işçi 2:47, nokta 4 3:30, bitiş 7:33). Fiyatlar ECONOMY_L1.md'den gelir.

## Temel döngü

Şarjı azalmış araçlar yoldan gelir ve boş şarj noktasına park eder. Oyuncu kabloyu takar; araç şebekeden şarj olur (oyunda 6 sn, gerçekte 20-30 dk). Sürücü araçtan iner, şemsiyeli masasına yürür ve 2 burger ister. Oyuncu mutfak tezgâhından burgerleri tepsiye alıp masaya götürür; her burger $3 ve para masaya düşer. Sürücü 3 sn yer, araca döner. Şarj bittiği halde sürücü masadaysa araç bekleme ücreti işletir. Sürücü dönünce araç şarj ücreti ile bekleme ücretini öder ve yola çıkar. 10 sn içinde yemek gelmezse sürücü aç kalkar.

## Zaman çizelgesi (oyun süresi, bot insan profili)

| Zaman | Olay | Oyuncunun gördüğü |
|---|---|---|
| 0:00 | Başlangıç ekranı | Tabela: EV CHARGING + DINER |
| 0:02 | İlk araç yoldan gelir | Kırmızı batarya ve 🔌, ok araca döner |
| 0:04 | Kablo takılır, sürücü masaya yürür | Kablo ve yeşil ekran; masada 🍔0/2 |
| 0:08 | Burgerler servis edilir | Masada +$3 +$3, 😋 |
| ~0:14 | Sürücü döner, araç öder ve gider | Yerde para, Upgrades butonu |
| ~0:51 | 2. şarj noktası ($50) | İki araç, iki masa |
| ~1:37 | 3. şarj noktası ($80) | Kablo, mutfak ve masa arasında koşturma; bekleme ücretleri görünür |
| ~2:47 | İşçi ($180) | İşçi kablo takar ve servis yapar |
| ~3:30 | 4. şarj noktası ($128) | Tüm noktalar ve masalar açık |
| 3:30-7:35 | Upgrade hatları | Seviye sonu ekranı |

## Tasarım kuralları

- Her an tek bir hedef öne çıkar (rehber ok): önce kablo, sonra yemek, sonra para.
- Pad'ler sırayla, tek tek görünür.
- Pad'e basılı durunca para 1 saniyede akar; yarım ödeme kaybolmaz.
- Fast Chargers daha çok araç demektir; yavaş servis bekleme ücreti getirir ama noktayı meşgul eder.
- Oyun kapatılıp açılınca offline kazanç bildirimi gösterilir (tavan 2 saat).
