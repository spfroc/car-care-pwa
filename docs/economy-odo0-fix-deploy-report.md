# Economy 1.27 fix deploy

- Time: 2026-10-12 15:43 Asia/Shanghai
- SHA: `6adcd15` (`6adcd1595313ca8989e62a46bec0a9e8976dc267`)
- Bundle: `index-f4r7_DP6.js` sha256 `2b4e8506438473c95796a1cd3bd9198152c73725e73cc5e19e5bc1239c53427c`
- Sites: car.adobesun.com + car-test.adobesun.com
- Backups: `/var/www/car-care-backups/car-care-pre-economy-fix-20261012-154249.tar.gz` + staging twin
- Root cause: history补录 odometer=0 invented 0→34448 mega-interval → weighted 1.27
- After fix on merged X-RV data: ~6.83 L/100km (参考), 统计/行驶 7416/41864
- Spend: hero after-baseline vs list all-filtered; i18n clarifies
- M3-B PR#6 untouched
