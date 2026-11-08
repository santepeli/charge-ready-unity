# Charge Ready – Unity prototipi

Greenfield Town'un çekirdek döngüsü: araç gelir, şarj olur, sürücü masaya oturur, sen burger taşırsın, para toplarsın, yeni şarj yeri açarsın. Sahne koddan kurulur, ekonomi `EconomyConfig` dosyasında.

## Telefona APK almak (bilgisayarda Unity kurmadan)

1. Bu klasörü yeni bir GitHub deposuna push et (private olabilir).
2. cloud.unity.com'da proje oluştur, DevOps > Build Automation'ı aç, GitHub deposunu bağla.
3. Yeni build hedefi ekle: Android, Unity sürümü 6000.0.23f1 (yoksa listedeki en yakın 6000.0.x).
4. Hedefin gelişmiş ayarlarında Pre-Export Method alanına şunu yaz: `ChargeReady.EditorTools.BuildSetup.PreExport`
5. Build'i başlat. Bitince APK'yı telefona indir ve kur (bilinmeyen kaynaklara izin vermen gerekebilir).
6. Build hata verirse log'un hata kısmını bana gönder, düzeltirim.

## Bilgisayarda açarsan

Unity Hub ile klasörü aç, menüden Charge Ready > Build Scene and Config çalıştır, Play'e bas.
