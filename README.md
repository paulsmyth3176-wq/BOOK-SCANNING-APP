# ShelfScan: your book inventory

Scan a book's barcode to add it to your library. At the bookstore, scan again to see whether you already own it.

## Put it online (one time, about 10 minutes, free)

The camera only works when the app is opened from an `https://` address, so it needs to be hosted somewhere. GitHub Pages is free and simple:

1. Unzip `shelfscan.zip` on your computer.
2. Go to **github.com** and create a free account (or sign in).
3. Click **+** (top right) → **New repository**. Name it `books` (any name works), set it to **Public**, and click **Create repository**.
4. On the new repo page, click **uploading an existing file**. Drag in all the files from the unzipped folder (`index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`), then click **Commit changes**.
5. Go to **Settings** → **Pages** (left menu). Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, and click **Save**.
6. Wait a minute or two, then refresh the page. It will show your address: `https://YOUR-USERNAME.github.io/books/`

Only the app's code is public. Your book list never leaves your phone.

## Install it on your Galaxy

1. Open your `https://…github.io/books/` address in **Chrome** on the phone.
2. Tap **⋮** → **Add to Home screen** → **Install**.
3. Open ShelfScan from the home screen. The first time you tap **Start camera**, allow camera access.

Once installed it works offline, so a bookstore with no signal is fine for checking. Looking up new books needs a connection.

## Using it

- **Add to library**: use this at home. Start the camera and scan books one after another. Each one is added automatically, with its title, author and cover.
- **Check**: use this at the store. You'll see a green **You already own this**, a yellow **On your wishlist**, or a red **Not in your library**. It also tells you if you own a different edition of the same title.
- **Add to wishlist**: for books you want to buy later.
- **Library tab**: search by title, author, ISBN or shelf. Tap a book to edit it, set its shelf or location, add notes, or delete it.
- **More tab**: back up, export to CSV, import, add a book by hand (for ones with no barcode), and fetch missing details.

### Barcode tips
- Aim at the barcode that starts with **978** or **979**. That one is the ISBN.
- Mass-market paperbacks often have a UPC price barcode on the back. Their ISBN barcode is usually inside the front cover.
- Older books with no barcode can be added by hand, or by typing the ISBN from the copyright page.

## Back up your list

Your list is stored in the browser on your phone. It can be lost if you uninstall Chrome, clear site data, or switch phones. Every so often, tap **More → Save backup** and keep the file in Google Drive or email it to yourself. **Restore or import** reads that file back in.

Import also accepts CSV exports from Goodreads, Libib, LibraryThing and most other book apps, or any spreadsheet with an ISBN or Title column. Duplicates are skipped.

## Updating the app

If you change a file later, upload the new version to the same GitHub repo. The phone picks up the update the next time the app is opened online, or the time after that.
