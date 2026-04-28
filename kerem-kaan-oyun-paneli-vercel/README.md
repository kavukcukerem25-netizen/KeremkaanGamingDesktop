# Kerem Kaan Oyun Paneli

Yerel çalışan web paneli. Site `127.0.0.1` üstünden açılır; oyun kartına basınca backend kayıtlı kısayol yolunu veya launch linkini işletim sistemine açtırır.

## Çalıştırma

Bu klasörde dış bağımlılık yok. `node` yeterli:

```bash
node scripts/generate-assets.js
node server.js
```

`npm` kuruluysa aynı işlem şu komutlarla da yapılabilir:

```bash
npm run assets
npm start
```

Sonra tarayıcıda:

```text
http://127.0.0.1:4173
```

## Oyun Ekleme

Panelde `Oyun Ekle` ile oyun adı ve kısayol yolu girilebilir. Örnekler:

```text
steam://rungameid/730
/Applications/Oyun.app
~/Desktop/Oyun.webloc
```

`Masaüstünü Tara` düğmesi masaüstünde ve uygulama klasörlerinde bulunan `.app`, `.lnk`, `.url`, `.webloc`, `.desktop`, `.command`, `.sh` ve `.exe` kısayollarını listeler.

## Vercel

Vercel'de site online vitrin olarak çalışır. Bulut sunucu Kerem Kaan'ın MacBook'una erişemediği için oyun açma, oyun kaydetme ve masaüstü tarama sadece yerel sürümde çalışır.

Vercel ayarları:

```text
Framework Preset: Other
Build Command: boş bırak
Output Directory: boş bırak
```
