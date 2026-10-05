# NEELAVATI MUCCOPS — GitHub Pages package

This folder contains the complete static website files required for GitHub Pages.

## Upload and publish

1. Create or open the GitHub repository that will host the website.
2. Upload **all files and folders from this package to the repository root**. Keep the `vendor` folder and the empty `.nojekyll` file.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/(root)`, then save.
6. GitHub will show the website URL after deployment finishes.

The root `index.html` is the website entry page. Relative asset paths are already configured for a GitHub project site URL.

## Included website files

- `index.html` — entry page
- `style.css` — complete design
- `app.js` — application and business logic
- `api.js` — secure-server detection with static fallback
- `recovery-demand-xlsx.js` — Excel export logic
- `vendor/jszip.min.js` — spreadsheet ZIP dependency
- `logo.jpg` — NEELAVATI MUCCOPS logo
- `.nojekyll` — serves the static files directly without Jekyll processing

## Important data and security note

GitHub Pages only hosts static files. This package stores application data in the current browser/device and does not provide a shared secure backend database. Data entered on one device will not automatically appear on another device. Do not treat this static build as a production banking database. A separate secured backend and database deployment is required for central multi-device data.
