# FEEL_SPEC: His tablosu

Charge Ready'nin "iyi hissettiren" öğeleri ve değerleri. Değerler `config.js` içindeki `feel` bloğundadır.

## Referans oyunlar

Yalnızca tür kalıpları ve zamanlama hissi için incelenir. Görsel, model, ses ve arayüz alınmaz.

| Oyun | Yayıncı | Ortak kalıp |
|---|---|---|
| Pizza Ready! | Supercent | Joystick, sırtta yığın, pad ile açılış |
| Burger Please! | Supercent | Joystick, yığın taşıma, personel ve upgrade |
| My Perfect Hotel | SayGames | Üstten görünüm, para toplama, alan genişletme |

## Öğeler

Değerler bizim tasarımımız, referans oyunlardan ölçülmedi. Ölçüm için referans oyunların 30 saniyelik ekran kayıtları gerekir. Kayıtlar gelince kare kare zamanlama çıkarılıp bu tablo güncellenir.

| Öğe | Değer | Amaç | Durum |
|---|---|---|---|
| Kahve makineden tepsiye uçar | 0,25 sn, 1,2 birim yay | Alma anını görünür kılar | Prototipte |
| Kahve tepsiden araca uçar, +$2 yükselir | 0,25 sn; yazı 1 sn | Satışı görünür kılar | Prototipte |
| Kablo takılır, şarj ekranı yanar | 0,3 sn | Ne sattığımız belli olur | Prototipte |
| Araç üstünde batarya göstergesi | Kırmızı → sarı → yeşil | Aracın neden geldiği belli olur | Prototipte |
| Para destesi oyuncuya uçar | 0,25 sn, desteler arası 0,04 sn | Kazancı ödül gibi hissettirir | Prototipte |
| Para sayacı akarak artar/azalır | Hız 12 | Kazanç ve harcama okunur | Prototipte |
| Para göstergesi sekmesi | 1,15 ölçek, 160 ms | Her kazançta küçük geri bildirim | Prototipte |
| Tepsideki yığın harekete göre eğilir | En fazla 0,3 rad, hız 8 | Yığına ağırlık hissi verir | Prototipte |
| Pad dolum çubuğu | Ödenen / toplam | Harcamanın ilerlediği görülür | Prototipte |
| Açılan öğe yaylanarak belirir | 0,35 sn, aşım 1,7 | Satın alma anını kutlar | Prototipte |
| Araçlar yoldan gelip gider, yolda trafik akar | 11 birim/sn | Canlı, gerçekçi çevre | Prototipte |
| Ses (kablo, alma, teslim, para, satın alma, bitiş) | Web Audio sentez | Ritim ve tatmin | Prototipte |
| Titreşim | 30 ms | Dokunsal geri bildirim | Prototipte (tarayıcı engelleyebilir) |
| Konfeti | 24 parça, 0,9 sn | Açılışı kutlar | Prototipte |

## Görsel varlık kaynağı

| Kaynak | Lisans | Not |
|---|---|---|
| Kenney | CC0, ticari kullanım serbest, atıf gerekmez | Unity aşamasında başlangıç seti. Kenney logosu kullanılmaz. |
| Synty (tek seferlik lisans) | Ticari kullanım serbest, telif ücreti yok | Lisans başına 5 kişilik ekip. Kaynak dosyalar ekip dışına paylaşılamaz. Yapay zekâ eğitimi ve model üretimi yasak. |

Kaynaklar: kenney.nl/support, syntystore.com/pages/one-time-purchase-licence (5 Kasım 2026'da okundu).
