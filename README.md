# Family Tree FREE and Open Source

**English** | [Tiếng Việt](README.vi.md)

A family tree app with a graph database behind it.

- Anyone can register, with email and password (confirmed by a verification email) or with Google or GitHub.
- Every account gets its own private tree and is a separate container: it manages only its own tree and sees only the trees it was invited to. There is no application-wide admin, so no account can see or manage other accounts.
- Every user can invite people by email to view, edit or help manage (admin) their own tree, and can hand a tree over to another member.
- Invited users switch between their own tree and the trees shared with them.
- Anyone can create more trees (**+ New tree…** in the tree switcher, up to 20 owned trees per account) and share each one separately. The owner can delete a tree on **Settings** after typing its name to confirm. That removes its people, photos, invitations and every member's access. If it was their last tree, they get a new, empty one.
- A new, empty tree offers **Load sample family**: 24 Vietnamese people over five generations, to try the app before entering your own family.

| Part | Stack | Deploys to |
| --- | --- | --- |
| [`backend/`](backend) | Node.js, Express 5, TypeScript, `neo4j-driver`, Zod, JWT | Vercel (serverless function) or any Node host |
| [`frontend/`](frontend) | Next.js (App Router), React, React Flow with its own family-tree layout ([`treeLayout.ts`](frontend/src/lib/treeLayout.ts)) | Vercel |
| Database | Neo4j AuraDB | Neo4j Aura (cloud) |
| Email | [Resend](https://resend.com) HTTP API (no SDK) | — |

```
Browser ──► frontend (Next.js) ──/api/* rewrite──► backend (Express) ──► AuraDB
                                                         └──────────────► Resend (emails)
```

The browser only ever talks to the frontend's domain. Next.js forwards `/api/*` to the backend, so the API is same-origin. That keeps the HttpOnly session cookie first-party, and the API needs no CORS.

## Data model

```
(:User {id, email, emailVerified, name, avatarUrl, passwordHash?, role, createdAt, lastLoginAt,
        verifyTokenHash?, verifyTokenExpiresAt?, resetTokenHash?, resetTokenExpiresAt?, passwordChangedAt?,
        remindersEnabled?, reminderDaysBefore?, locale?,    // locale: language of reminder emails
        privacyVersion?, privacyAcceptedAt?, privacyWithdrawnAt?})   // the personal data agreement accepted
(:User)-[:HAS_ACCOUNT]->(:Account {provider, providerAccountId})        // one per linked social login
(:User)-[:REMINDS {since, lastSentFor?}]->(:Person)   // email me before this person's death anniversary

(:Tree {id, name, createdAt, bulkDelete?, birthCalendar?, deathCalendar?})
    // per-tree settings; missing = bulk delete on, 'solar' (an older `calendar` property is the fallback for both)
(:User)-[:MEMBER_OF {role: 'owner' | 'admin' | 'editor' | 'viewer', since, personId?, scopeRootId?, scopeDepth?}]->(:Tree)
    // personId: "This is me"; scopeRootId/scopeDepth: an editor limited to one branch (missing = whole tree)

(:Person {id, treeId, firstName, lastName, gender, birthDate, deathDate, birthPlace, address, photoUrl, bio,
          createdAt, updatedAt})
(:Person)-[:PARENT_OF]->(:Person)     // directional: parent -> child
(:Person)-[:SPOUSE_OF]-(:Person)      // treated as undirected

(:Photo {id, treeId, storage, storageRef, contentType, size, uploadedBy, createdAt})   // an uploaded photo

(:Invitation {id, treeId, email, role, invitedBy, scopeRootId?, scopeDepth?, tokenHash, createdAt, expiresAt})

(:Keepalive {id, pingedAt, count})    // one node, written daily so AuraDB Free never pauses
```

- **Trees:** each account is created with a private tree it **owns**, and can be a member of any number of other trees.
- **Scoping:** every person belongs to exactly one tree (`treeId`). All people and relationship queries go through `/api/trees/:treeId/...` and check the caller's membership first. Non-members get `404`, so the API doesn't even reveal that a tree exists.
- **Dates:** they accept `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, since genealogy dates are often partial. The API rejects a `PARENT_OF` link that would make someone their own ancestor.
- **Parent age:** a parent must be at least 16 years older than their child (`MIN_PARENT_AGE` in [`backend/src/trees/rules.ts`](backend/src/trees/rules.ts)). It is checked when both birth dates are known, at their common precision (`1990` vs `2006-03-01` compares years), when linking people, importing, and changing a birth date. The person picker greys out people who don't qualify.

## Languages (English / Tiếng Việt)

The language picker (🌐) in the header switches the UI between English and Vietnamese.

- **Storage:** the choice is saved in a `lang` cookie. The server reads it when rendering, so pages load straight in the chosen language, and the page title and `<html lang>` follow it.
- **First visit:** visitors whose browser prefers Vietnamese get Vietnamese.
- **Names:** in Vietnamese they are shown family name first (*Nguyễn Văn An*), and the person form asks for *Họ* before *Tên*.
- **Translations:** all UI text lives in [`frontend/src/lib/i18n.ts`](frontend/src/lib/i18n.ts). English is the reference, and TypeScript fails the build if a key is missing from another language. To add a language, add its code to `locales` and a dictionary with the same keys.
- **API errors:** an error can carry a `code` next to its English `error` text, e.g. `{ "error": "A parent must be…", "code": "parentTooYoung" }`. The UI shows its own `error.<code>` translation and falls back to the English text for codes it doesn't know. To translate another error, pass a code as the third argument of `HttpError` and add `error.<code>` to both dictionaries.
- **Not yet translated:** most other API errors (validation, "Invalid email or password"…) and the verification, password reset and invitation emails are still in English.

## Importing from CSV or Excel

Editors and owners can bulk-add people on **Import** (`/import`):

1. **Download a template.** Templates come as Excel (`.xlsx`, with an *Instructions* sheet) or CSV (UTF-8 with a BOM, so Excel shows Vietnamese correctly). Headers follow the UI language, and example rows show a small family.
2. **Fill it in.** Put one person per row. **First name** is the only required column. Give each row an **ID** (any code unique within the file), then link people with **Father ID**, **Mother ID** and **Spouse IDs** (separated by `;`). Dates accept `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or `DD/MM/YYYY`, as well as real Excel date cells. Gender accepts Male/Female/Other, Nam/Nữ or M/F.
3. **Upload** a `.csv`, `.xlsx` or `.xls` file. The browser reads it with [SheetJS](https://sheetjs.com) and asks the API to check it (`dryRun`). The page then shows a preview and every problem with its spreadsheet row number.
4. **Match people already in the tree.** Rows that may be someone already in the tree are listed under *Possibly already in the tree*. For each, choose *A new person* or *Same as …* (see below).
5. **Import.** Nothing is written until the whole file is valid, and then everything is written in one transaction.

### Importing several files, and people already in the tree

- **Possible matches:** the check compares every row with the tree's people. A row matches someone when it has the same name words, ignoring accents, case, word order and how the name is split between the *Last name* and *First name* columns, and the birth years don't differ when both are known. A match with the same birth year is marked ✓ and starts out chosen as *Same as …*. Matches by name only start as *A new person*.
- **"Same as …":** the row isn't created; it stands for that person. Links in the file to the row (*Father ID*, *Mother ID*, *Spouse IDs*) then attach to them. That way a second file can add a branch under people already in the tree: include a row for the existing ancestor, match it, and point the new rows' *Father ID* at it. The existing person's details are kept as they are.
- **Checks against the tree:** with matched rows, the ancestry-loop check includes the tree's own parent links, and the parent-age rule uses the matched people's birth dates from the tree. Each person in the tree can be matched with one row only. Links that already exist aren't doubled (`MERGE`).
- **Duplicates already in the tree:** use **Merge with…** (below).

Details:

- **Headers:** matched loosely, ignoring case, accents and punctuation, in English or Vietnamese (`First name`, `first_name`, `Tên`…). The parser reads the first sheet that has a "First name" header within its first 10 rows. Columns it doesn't recognise are listed and ignored.
- **Existing people:** IDs only link rows within the same file. A row reaches someone already in the tree only through a match (above), and an import never changes existing people.
- **Checks:** duplicate IDs (case-insensitive), links to missing IDs, self-links, father = mother, a death date before the birth date, and parent links that would make someone their own ancestor.
- **Limits:** at most 2000 people per file (2 MB request).
- **SheetJS:** it is installed from the SheetJS CDN tarball (`xlsx-0.20.3`), because the `xlsx` package on npm is stuck at 0.18.5, which has known vulnerabilities. It is loaded only on the import page.

## Merging duplicates

When someone is in the tree twice (two imports, or added by hand twice), an editor of the whole tree opens one of them and clicks **Merge with…**:

1. **Pick the other record.** The search starts with this person's name. Their own parents, children and spouses aren't offered.
2. **Compare.** The two records are shown side by side. Where both have a different value (name, dates, places, photo, bio…), choose which to keep. Values only one of them has are kept automatically.
3. **Merge.** In one transaction, the other record's parents, children and spouses move to this person (links they share aren't doubled). So do anniversary reminders, members' *This is me* links (unless another member is already linked to this person), and editors' branches that started from the other record. The other record is then deleted, along with an uploaded photo nobody uses any more.

The merge is refused, and nothing changes, when the two are each other's parent, child or spouse (`409`, `mergeRelated`), when one is the other's ancestor further back so the result would be their own ancestor (`mergeCycle`), or when the result breaks the parent-age rule. Editors limited to a branch can't merge, because a merge can move links anywhere in the tree.

## Person photos

A person's photo is either a link (`https://…`) or an image uploaded from the person form. Uploading is available once `PHOTO_STORAGE` is set (see step 4 below); until then the form only shows the link field.

1. **Take or choose a photo.** On a PC the photo button opens a file picker (JPEG, PNG, WebP or GIF). On phones and tablets it offers **Take photo**, which opens the rear camera since it's mostly used for old printed photos, or **Choose a photo** from the library.
2. **Adjust it.** The photo opens in an editor ([`PhotoEditor.tsx`](frontend/src/components/PhotoEditor.tsx)):
   - **Move and zoom:** drag to move; pinch, scroll or use the slider to zoom (up to 4×).
   - **Rotate and straighten:** quarter turns, plus a *Straighten* slider (±20°) for tilted shots of printed photos.
   - **Frame:** *Square*, *Portrait* (3:4) or *Whole photo*. A circle shows what the round avatar will show.
   - **What you see is what gets saved:** the preview and the saved image are drawn by the same code ([`photoCrop.ts`](frontend/src/lib/photoCrop.ts)), and the photo always covers the frame. The result is at most 1200 px and never enlarged beyond the original's resolution. The form previews it but uploads nothing yet, so *Cancel* leaves nothing behind.
3. **Save.** The browser shrinks the image to at most 1200 px and re-encodes it as WebP, or as JPEG in browsers that can't encode WebP (Safari). Files under 200 KB that are already small enough stay as they are. It then sends the bytes to `POST /api/trees/:treeId/photos`, and saves the returned path as the person's `photoUrl`.
4. **Store.** The API checks the file's first bytes (SVG and anything else is refused with `415`), stores it in S3 or Google Drive, and records a `:Photo` node.
5. **View.** `photoUrl` is `/api/trees/:treeId/photos/:id`. The API checks tree membership and streams the file. The bucket or Drive folder never has to be public, and a photo is only visible to members of its tree.

Replacing or removing a photo, deleting the person, or deleting the account that owns the tree deletes the stored file, unless another person in the tree still uses it.

## Tree layout

Large families (hundreds of people) drawn with one row per đời become extremely wide: in a 237-person, 6-generation sample, about 32 times wider than tall. **Layout** in the tree toolbar offers a direction and three options to make the tree fit the screen:

| Option | What it does |
| --- | --- |
| Direction | *Top-down* (a đời per row) or *Left to right* (a đời per column, so on a phone you mostly scroll down) |
| Couples stacked | The spouse sits under the family member, so a couple is one card wide. Left to right always shows couples this way |
| Childless siblings stacked | Brothers and sisters with no children in the tree go in short columns (4 at most) hanging from one line, after the siblings who have children. Birth order is kept within each group |
| Branches wrapped into rows | Each of the founders' children starts a chi, drawn in its own labelled frame (*Chi 2 · Nguyễn Văn Bình*). The frames wrap onto rows that roughly match the shape of the view, joined to the founders by a line along the left edge |

**Defaults:** PCs and tablets start with *Top-down* and all three options on (the sample above becomes about 1.4 : 1). Phones, meaning screens narrower than 768 px, start with *Left to right* and stacked siblings. The choice is remembered in the browser, separately for phones and larger screens, and *Reset to the default for this screen* undoes it. With all options off and *Top-down*, the tree is drawn the classic way.

The layout is pure code in [`frontend/src/lib/treeLayout.ts`](frontend/src/lib/treeLayout.ts). It computes every card position and every line's path (including stacked columns and the wrapped rows' trunk), and the tree view draws those paths as they are.

## Downloading the tree (PNG or PDF)

The **Download: Image / PDF** buttons in the top-right corner of the tree save the whole tree currently shown: everyone, or the branch you focused on. It doesn't matter how far you've zoomed or scrolled.

- **What's on it:** a title (the tree's name, plus the focused person if any) and a line with the number of people and today's date, then the tree as it looks on screen, including kinship labels and the selected person. The colours follow the current light or dark theme.
- **In the browser:** everything happens on your device, and nothing is sent to the server. [`html-to-image`](https://github.com/bubkoo/html-to-image) draws the diagram, following React Flow's export recipe. [jsPDF](https://github.com/parallax/jsPDF) wraps it in a PDF. Both load only when you click.
- **Vietnamese text:** the title is drawn with the browser's fonts and embedded in the image, because jsPDF's built-in fonts can't show Vietnamese accents.
- **PDF:** one page the size of the tree. Zoom in on screen, or print with "fit to page".
- **Large trees:** images are capped at about 16 million pixels so every browser (including Safari) can make them. Very large trees are therefore scaled down; focus on a branch for more detail.

## "This is me" and the default view

Every member of a tree (owner, editor or viewer) can select a person and click **This is me** (*Đây là tôi*). That links their account to that person in that tree. It changes only their own membership (`MEMBER_OF.personId`), not the tree, so you can be a different person in each tree you belong to. **Not me** removes the link.

- **Fast first load:** a tree where you're linked opens **around you, 3 family hops deep** (`GET /graph?rootId=<you>&depth=3`). That's you, parents up to great-grandparents, children down to great-grandchildren, siblings, uncles and aunts, and spouses, instead of loading everyone. You are selected, so the kinship labels read from your point of view, and your card is marked **You / Bạn**.
- **Getting around:** the toolbar shows "*12 of 240 people*" while focused. **Show everyone** loads the whole tree, the depth selector widens the view, and **Around me** returns to you. Opening someone from the **People** page focuses the tree on them.
- **Unlinked trees** still load everyone, as before.
- **Rules:** a person can be linked to at most one member of the tree (`409`, `code: "personTaken"`). If the person is deleted, the link simply stops counting. On **Share**, the owner sees which person each member is.

## Death anniversary reminders (ngày giỗ)

Any member of a tree, viewers included, can get an email before a person's death anniversary.

1. **Choose people.** Open someone with a full death date (year, month and day) and click **🔔 Remind me of the ngày giỗ**. This applies only to you (`(:User)-[:REMINDS]->(:Person)`). Click again to stop.
2. **Turn reminders on.** On **My account** (`/account`), under *Death anniversary reminders*, tick *Email me before death anniversaries* and choose how many days before (0–30, default 3). The same section lists everyone you get reminders for, each with a *Stop* button.
3. **Get the email.** A daily job at about 07:00 Vietnam time sends **one email per user** listing every anniversary that is exactly that many days away. It is written in the language you last used the app in.

**How the anniversary is counted:** it follows the tree's calendar for death dates (see Settings).
- **Solar:** the same day and month. A death on 29 February is remembered on 28 February in other years.
- **Âm lịch:** the same lunar day and month every year, with the solar date and can-chi year in the email. As is customary, a death in a leap month is remembered in the regular month of that number, and a death on the 30th falls on the 29th when that month has only 29 days. The first giỗ can fall in the same solar year as the death (e.g. a death in early January).

**Details:**
- Each reminder remembers the anniversary it was last sent for, so the job never sends the same one twice.
- Leaving or being removed from a tree deletes your reminders for its people, and deleting a person deletes theirs. Year-only or year–month death dates can't have reminders (`400`, `code: "reminderNeedsFullDate"`).
- The anniversary rules are in [`backend/src/reminders/anniversary.ts`](backend/src/reminders/anniversary.ts), and the backend has its own copy of the lunar conversion ([`backend/src/lib/lunar.ts`](backend/src/lib/lunar.ts)).

## Kinship terms (cách xưng hô)

Selecting a person in the tree labels everyone connected to them with what the selected person calls them, in Vietnamese. You can switch this off with the **Xưng hô** checkbox in the toolbar. The terms are computed in the browser ([`frontend/src/lib/kinship.ts`](frontend/src/lib/kinship.ts)) from the shortest family path, preferring blood ties over marriage. They follow common Northern usage:

| Relation | Terms |
| --- | --- |
| Ancestors | Bố, Mẹ · Ông/Bà nội/ngoại · Cụ · Kỵ |
| Descendants | Con trai/gái · Cháu nội/ngoại · Chắt · Chút · Chít |
| Siblings | Anh trai, Chị gái, Em trai/gái |
| Parent's siblings | Bác (older than the parent); father's side: Chú, Cô; mother's side: Cậu, Dì |
| Their spouses | Bác, Thím, Dượng, Mợ |
| Grandparent's siblings | Ông bác, Ông chú, Bà cô, Ông cậu, Bà dì… |
| Cousins | Anh/Chị họ or Em họ, by the **parents'** seniority (con bác là anh/chị) |
| Nieces, nephews and below | Cháu, Cháu họ, Chắt… |
| Marriage | Vợ/Chồng · Con dâu/rể · Chị dâu, Anh rể, Em dâu/rể · Bố/Mẹ vợ/chồng · Anh/Chị/Em vợ/chồng · Thông gia · Bố dượng/Mẹ kế |

Seniority (bác vs chú, anh vs em) comes from **birth dates**. When dates are missing, both options are shown (e.g. *Chú/Bác*), so adding birth years makes the labels exact. Southern usage differs; for example, Dì and Cậu are used regardless of age. You can adjust the rules in `elderTerm`.

## Accounts and sign-in

### Email and password, with verification

1. `POST /api/auth/register { name, email, password }` creates the account, signs the user in, and emails a verification link to `<PUBLIC_APP_URL>/verify-email?token=…`. The link is valid for 24 hours.
2. Until the link is clicked, the app shows a **"Check your inbox"** screen with a *Resend* button (`POST /api/auth/resend-verification`, at most once a minute). The tree and invitation APIs return `403`.
3. Opening the link calls `POST /api/auth/verify-email { token }`, which marks the email verified.

Details:

- **Passwords:** hashed with **scrypt** (Node's built-in `crypto`, with a random salt per user). They must be 8–128 characters.
- **Login timing:** login always runs a hash comparison, even for unknown emails, so response times don't reveal which emails have accounts.
- **Brute-force limit:** after 10 failed logins for the same IP and email, login is blocked for 15 minutes. The counter is kept in memory, so on serverless hosts it applies per warm instance only.
- **Link tokens:** verification and invitation links contain 256-bit random tokens. Only their SHA-256 hashes are stored, and each link can be used once.
- **Squatted addresses:** if someone registers an address they don't own and never verifies it, the real owner can register it once the link has expired (24 hours), provided that account is still empty.
- **Takeover protection:** if the owner of an address signs in with Google or GitHub first, the unverified password is removed and the social login is linked to that account.

### Forgot and change password

- **Forgot password:** *Forgot password?* on the sign-in form opens `/forgot-password`. `POST /api/auth/forgot-password { email }` emails a link to `<PUBLIC_APP_URL>/reset-password?token=…`, valid for 1 hour and usable once. The answer is the same whether or not the account exists, and an address gets at most one email a minute.
- **Reset:** `POST /api/auth/reset-password { token, password }` sets the new password and signs the user in. The link proves the user controls the inbox, so it also verifies the email. A Google/GitHub-only account can use it to add a password.
- **Change password:** clicking your name in the header opens **My account** (`/account`). `POST /api/auth/change-password { currentPassword, newPassword }` needs the current password (10 wrong tries block it for 15 minutes).
- **Other sessions:** resetting or changing the password stores `passwordChangedAt`, and sessions issued before it get `401`. The browser that made the change gets a fresh cookie and stays signed in.

### Change email and delete the account

Both are on **My account** (`/account`), and accounts with a password confirm with it again (wrong tries count towards the same limit as sign-in).

- **Change email:** `POST /api/auth/email { email, password? }` stores the address as *pending* and emails a link to it: `<PUBLIC_APP_URL>/confirm-email?token=…`, valid for 24 hours. The old address gets a notice, so a stolen session can't quietly redirect the account. Clicking the link (`POST /api/auth/email/confirm { token }`, no session needed) makes it the account's verified email. Until then, the old email keeps working and `GET /api/auth/me` shows `pendingEmail`. `DELETE /api/auth/email` cancels. An address used by another account is refused (`409`, `emailTaken`), and a new link can be requested once a minute. Trees, memberships, reminders and Google/GitHub sign-in are tied to the account, not the address, so they all follow.
- **Delete account:** `POST /api/auth/delete-account` with `{ password }`, or `{ confirm: "<the account's email>" }` for Google/GitHub-only accounts. It deletes the account, its sign-in links and every tree it owns (people, photos, invitations), removes its memberships of other trees and its reminders, and signs out. The page lists the owned trees that other people use, and suggests handing them over with **Make owner** first.

### Personal data agreement (Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15)

Vietnam's Personal Data Protection Law (in force since 1 January 2026) requires informed, explicit consent that can be withdrawn. The app asks for it before anyone uses a tree:

- **The agreement:** `/privacy`, readable by anyone. It is in Vietnamese, the text that applies, with an English translation for reference. It names the controller, the data processed, four separate purposes (reminder emails are optional and switched on separately), the service providers and transfers abroad, retention, users' duties when entering relatives' data (living people, children under Điều 24, the deceased), the rights under Điều 4 and how to use them in the app, and breach notification. The text is in [`frontend/src/lib/privacyAgreement.ts`](frontend/src/lib/privacyAgreement.ts).
- **Who runs the site:** set `NEXT_PUBLIC_PRIVACY_CONTROLLER` (name) and `NEXT_PUBLIC_PRIVACY_CONTACT` (an email for data requests) in the frontend project. Until then the page says they aren't configured.
- **First sign-in:** registering with email and password requires ticking an (unticked) box that links to the agreement. Google/GitHub accounts and accounts made before the agreement see a full-screen agreement with two confirmation boxes the first time they sign in. *Accept and continue* calls `POST /api/auth/privacy { version }`. *I don't agree* signs out; the account can still be deleted from **My account**.
- **Enforcement:** until the current version is accepted, `/api/trees/*` and the invitation endpoints answer `403` (`code: "consentRequired"`), and no reminder emails are sent. **My account** stays open, so the user can read the agreement, accept it, or delete the account.
- **Record and withdrawal:** the accepted version and time are stored on the user (`privacyVersion`, `privacyAcceptedAt`). *Withdraw consent* on **My account** (`DELETE /api/auth/privacy`) clears them and records `privacyWithdrawnAt`, which pauses trees, invitations and reminders again. The data stays until the user deletes it.
- **New versions:** change the text, then bump `PRIVACY_VERSION` in both `frontend/src/lib/privacyAgreement.ts` and `backend/src/auth/privacy.ts`. Everyone is then asked again, with a note that the agreement changed. A client showing an older version gets `409` (`privacyOutdated`).

The agreement is a starting point written for this app, not legal advice. Have it reviewed for your situation. The law also gives the controller duties outside the app, such as impact assessment files for processing and cross-border transfers (Điều 20–21).

### Google and GitHub

The backend runs the OAuth flow itself, so no third-party auth service is involved. Provider-verified emails count as verified. Signing in and registering are the same flow.

1. The frontend sends the browser to `/api/auth/:provider/login?next=/people`.
2. The backend stores a signed, short-lived `state` cookie (plus a PKCE verifier for Google) and redirects to the provider.
3. The provider returns to `<frontend>/api/auth/:provider/callback`, which is proxied to the backend. The backend checks the state, fetches the profile, and creates or updates the `User`.
4. The backend sets the session cookie and redirects to `next`. Only same-site paths are accepted.

If someone signs in with Google and GitHub using the same verified email, both are linked to one user.

### Sessions and CSRF

- **Session cookie:** `ft_session` holds a signed JWT. It is `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, and lasts `JWT_EXPIRES_IN`. `POST /api/auth/logout` clears it.
- **CSRF:** every POST, PATCH or DELETE request must also carry `X-Requested-With: fetch`. Other sites can't add that header without a CORS preflight, which the API never approves.

## Sharing trees with invitations

### Roles

Roles exist only per tree. Accounts have no role: every account is equal and is the owner of its own tree.

| Role | Can |
| --- | --- |
| `owner` | Full control of the tree: everything an admin can do, plus make and remove admins, load the sample family, and hand the tree over (**Make owner**). Each tree has exactly one owner |
| `admin` | Edit the whole tree, rename it, invite people and manage editors and viewers (**Share**), and change its **Settings** (`/settings`). Admins can't change or remove other admins or the owner, or touch invitations of new admins |
| `editor` | View the tree, and add, edit and delete people and relationships (everywhere, or only in one branch; see below) |
| `viewer` | View the tree and people list only |

### Limiting an editor to one branch

When inviting an editor (or later, with *Change* next to an editor on **Share**), the owner can choose **One branch only** instead of **The whole tree**. They pick the person the branch starts from and how many đời it covers, counting that person as the first: *1 đời* is only them, *2 đời* reaches their children, *3 đời* their grandchildren, up to *11 đời*, or *All generations*, which is capped at 20 generations below them. The API stores the number of generations *below* the person (`depth`, 0–20), so `depth` = đời − 1. The branch is then:

- that person,
- their descendants (`PARENT_OF` downwards) down to the chosen generation, and
- the spouses of all of them.

The editor still **sees** the whole tree. They can **change** only people in the branch:

- **Edit people:** anyone in the branch.
- **Delete people:** anyone in the branch except its first person, who would take the whole branch with them.
- **Add new people:** only as a child (within the generation limit) or spouse of someone in the branch. Unlinked people and new parents would fall outside it, so the toolbar has no *+ Add person* button and **Import** is unavailable.
- **Add or remove relationships:** only between two people of the branch, and never a parent for its first person. A new parent link is undone if it would bring people who were outside the branch into it, for example by shortening the way down to someone who was too many generations below.

The API enforces all of this (`trees/branch.ts`, `403` with `code: "outsideBranch"`). The UI only offers what is allowed. If the branch's first person is deleted, that editor can change no one until the owner picks a new branch. Accepting an invitation keeps the wider access: owner, then editor of the whole tree, then editor of a branch, then viewer. If both the current access and the invitation are branches, the invitation's branch is used.

- Accounts only meet through invitations: an owner invites someone, and only then can that person see the tree (and the owner sees them as a member on **Share**).
- No page or API lists accounts. Running the app (database access, deploy settings) is the only "admin" level, and it lives outside the app.

### Invitation flow

1. **Send.** The tree's owner (any user, for their own tree) opens **Share** (`/share`) while viewing that tree, then enters an email address and chooses **View only** (`viewer`) or **Can edit** (`editor`). The invitee gets an email with a link to `<PUBLIC_APP_URL>/invite?token=…`, valid for 7 days. Inviting the same address again replaces the old link. Because registration is open, each account can send at most 20 invitation emails (including resends) per 24 hours. The count is kept on their `User` node, so it holds on serverless hosts too.
2. **Open the link.** The landing page shows who invited them to which tree.
   - **No account yet:** *Create account & join* opens registration with the email prefilled. Registering with the invited address verifies it automatically, because the link proves the person controls that inbox, and joins the tree immediately. Google or GitHub sign-in works too.
   - **Existing account:** sign in, then click *Join*. Accepting through the link also verifies the email if it wasn't verified yet.
3. **Use the shared tree.** The **tree switcher** in the header lists *My tree* and *Shared with me* (with each tree's access level). Viewers see a read-only UI, and the API enforces the same rule.
4. **Pending invitations** for a user's verified email also appear as a banner on the tree page, with *Accept* and *Decline*. This helps if the email gets lost.

An invitation only works for the account whose **verified** email matches the invited address, so a forwarded or leaked link is useless to anyone else.

On **Share**, the owner and admins can also change members' roles, remove access, and resend or revoke pending invitations, each within the roles they manage (see the table above). Members, admins included, can leave a shared tree from the tree page.

### Handing a tree over

The owner can click **Make owner** next to any member on **Share**. After a confirmation, that member becomes the owner and the previous owner stays on as an admin. Both changes happen in one database statement, so a tree always has exactly one owner. Only the new owner can hand it back or remove the previous owner.

The previous owner then owns no tree, so the next time their trees load they get a new, empty private tree (the same step that gives every account its own tree). The new owner can own several trees, all listed under *My tree*. Deleting an account deletes only the trees it owns at that moment, so handing a tree over first keeps it alive.

### Settings (`/settings`)

- **Your account:** every user can change their own name, which is shown in the header and to the people they share with.
- **This family tree:** the owner and admins can rename the tree (members see the new name) and change its settings: bulk delete and the calendars. Only that tree is affected.
- **Calendars (Dương lịch / Âm lịch):** birth dates and death dates each have their own calendar, *Solar* (the default) or *Lunisolar*, the Vietnamese lunar calendar. Families often keep birth dates in dương lịch and death dates (ngày mất, for ngày giỗ) in âm lịch. For each kind of date kept in âm lịch:
  - **Showing dates:** full dates are shown as lunar dates, e.g. *Ngày 15 tháng 8 năm Giáp Thìn (1964) âm lịch* with the solar date beneath it, and *15/8/1964 ÂL* on the People page. The tree shows lunar years.
  - **Entering dates:** the add and edit forms take lunar dates (`YYYY-MM-DD` plus a *Tháng nhuận* / leap month box), show the solar equivalent, and refuse lunar dates that don't exist, such as a 30th day in a 29-day month or a leap month the year doesn't have.
  - **Storage:** dates are always saved as their exact solar day. A full lunar date maps to exactly one solar day and back, so a ngày mất typed in âm lịch always reads back as the same lunar date. Switching calendars changes nothing in the data. Imports, age checks and the API use solar dates.
  - **Year-only and year–month dates:** a year alone is kept as typed. A year and month can't be converted, because a month may fall on either side of Tết, so in âm lịch the form asks for a full date or the year only.
  - **Conversion:** `frontend/src/lib/lunar.ts` uses Hồ Ngọc Đức's algorithm for Vietnam's time zone (UTC+7), so it follows the Vietnamese calendar where it differs from the Chinese one (e.g. Tết 1985 was 21 January in Vietnam).
- **Default tree name:** a new account's tree is named in the language the user registered in: *Gia phả của {tên}* in Vietnamese, *{name}'s family tree* in English. The API reads it from the app's `lang` cookie, or else the browser's language. Owners can rename it to anything, e.g. *Gia phả họ Nguyễn*.

## API

Public (no session):

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Checks the API and the AuraDB connection |
| GET | `/api/features` | `{ photoUploads }`: whether photo storage is configured |
| GET | `/api/auth/providers` | The login providers that are configured |
| GET | `/api/auth/:provider/login?next=` | Starts social login or registration |
| GET | `/api/auth/:provider/callback` | OAuth callback |
| POST | `/api/auth/register` | `{ name, email, password, inviteToken?, privacyVersion }`. `privacyVersion` is the personal data agreement version the user ticked. Creates the account, signs in, and sends the verification email (or joins the invited tree) |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/verify-email` | `{ token }` from the verification link |
| POST | `/api/auth/forgot-password` | `{ email }`. Emails a password reset link if the account exists |
| POST | `/api/auth/reset-password` | `{ token, password }`. Sets the new password, signs out other sessions, and signs in |
| POST | `/api/auth/logout` | Clears the session cookie |
| GET | `/api/invitations/preview?token=` | Inviter, tree, email and role for the invitation landing page |

Signed in:

| Method | Path | Requires | Description |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | — | The signed-in user, including `verificationRequired`, `hasPassword` and `consentRequired` |
| PATCH | `/api/auth/me` | — | `{ name }`. Change your own display name |
| GET / PATCH | `/api/auth/reminders` | — | Death anniversary reminder preferences: `{ enabled, daysBefore, people }`. PATCH takes `{ enabled?, daysBefore? }` (0–30) and remembers the UI language for the emails |
| POST / DELETE | `/api/auth/privacy` | — | POST `{ version }`: accept the personal data agreement (`409`, `privacyOutdated`, for an older version). DELETE withdraws consent |
| POST | `/api/auth/change-password` | — | `{ currentPassword, newPassword }`. Signs out other sessions |
| POST / DELETE | `/api/auth/email` | — | POST `{ email, password? }`: emails a confirmation link to the new address (and a notice to the old one). DELETE cancels a pending change |
| POST | `/api/auth/email/confirm` | public | `{ token }` from the link: the new address becomes the account's email |
| POST | `/api/auth/delete-account` | — | `{ password }` or, without a password, `{ confirm: email }`. Deletes the account and the trees it owns, then signs out |
| POST | `/api/auth/resend-verification` | — | Emails a fresh verification link |
| POST | `/api/invitations/accept` | — | `{ token }`. Accept from the emailed link (also verifies a matching unverified email) |
| GET | `/api/invitations/mine` | verified | Pending invitations for my email |
| POST | `/api/invitations/:id/accept` / `decline` | verified | Respond from the in-app banner |
| GET | `/api/trees` | verified | My trees: `{ id, name, role, settings, myPersonId, ownerName, personCount, memberCount }` |
| POST | `/api/trees` | verified | `{ name }`. Creates a new, empty tree that you own and returns its summary. `409` (`code: "treeLimit"`) once you own 20 trees |
| PATCH | `/api/trees/:treeId` | admin | `{ name }`. Rename |
| DELETE | `/api/trees/:treeId` | owner | Deletes the tree with its people, relationships, photos (also from storage), invitations and memberships |
| POST | `/api/trees/:treeId/transfer` | owner | `{ userId }`. That member becomes the owner; you become an admin |
| GET | `/api/trees/:treeId/persons?search=&limit=` | viewer | List or search people |
| GET | `/api/trees/:treeId/persons/:id` | viewer | One person with all their details, plus their parents, children and spouses as summaries (`id, firstName, lastName, gender, birthDate, deathDate`) |
| POST / PATCH / DELETE | `/api/trees/:treeId/persons[/:id]` | editor | Create, partially update (`null` clears a field) or delete a person. POST takes an optional `link: { relation: "parent" \| "child" \| "spouse", personId }` to add the new person as that relative in the same transaction (required for branch editors) |
| POST | `/api/trees/:treeId/persons/merge` | editor | `{ keepId, removeId, fields? }`. Merges `removeId` into `keepId` (see *Merging duplicates*) and returns the kept person. `fields` are the kept person's values to set. Not for branch editors |
| POST | `/api/trees/:treeId/persons/delete` | editor | `{ ids }` (up to 1000). Deletes those people and their relationships, and returns `{ deleted }`. `403` (`code: "bulkDeleteDisabled"`) when bulk delete is turned off for this tree |
| GET | `/api/trees/:treeId/settings` | viewer | This tree's settings: `{ bulkDelete, birthCalendar, deathCalendar }`, the calendars being `"solar"` or `"lunisolar"` (also included in `GET /api/trees`) |
| PATCH | `/api/trees/:treeId/settings` | admin | Change this tree's settings, e.g. `{ "deathCalendar": "lunisolar" }`. Other trees are not affected |
| POST / DELETE | `/api/trees/:treeId/relationships` | editor | `{ type: "PARENT_OF" \| "SPOUSE_OF", fromId, toId }`. DELETE takes these as query parameters |
| POST | `/api/trees/:treeId/photos` | editor | Body: the image file itself (JPEG, PNG, WebP or GIF, at most 4 MB). Returns `{ id, url }`; save `url` as a person's `photoUrl` |
| GET | `/api/trees/:treeId/photos/:id` | viewer | The uploaded image |
| GET | `/api/trees/:treeId/graph?rootId=&depth=` | viewer | `{ nodes, edges }` for the whole tree or `depth` (1–8) hops around `rootId`, reached breadth-first. People come as summaries (`id, firstName, lastName, gender, birthDate, deathDate`): what the cards, layout and kinship terms need. Other details (bio, address, birthplace, photo) load with `/persons/:id` for the person clicked |
| POST | `/api/trees/:treeId/import` | editor | `{ people: [{ row, key, firstName, …, fatherKey?, motherKey?, spouseKeys? }], matches?: { [rowKey]: personId }, dryRun? }`. With `dryRun`, returns `{ valid, rowErrors, summary, candidates }`, where `candidates` lists, per lowercased row key, people in the tree who may be that row (`strong`: same birth year). Otherwise it imports all rows in one transaction, or answers `400` with `rowErrors`. Matched rows aren't created; links to them go to the matched person |
| POST | `/api/trees/:treeId/sample` | owner | Adds the sample family (24 people, five generations) to an empty tree and returns `{ people, parentLinks, spouseLinks }`. `409` if the tree already has people |
| PUT / DELETE | `/api/trees/:treeId/reminders/:personId` | viewer | Turn your own anniversary reminders for that person on or off. PUT needs a full death date (`400`, `reminderNeedsFullDate`) |
| PUT | `/api/trees/:treeId/me` | viewer | `{ personId }`. "This is me": link your membership to that person. `409` (`personTaken`) if another member is linked to them |
| DELETE | `/api/trees/:treeId/me` | viewer | Remove your "This is me" link |
| DELETE | `/api/trees/:treeId/membership` | editor/viewer | Leave a shared tree |
| GET | `/api/trees/:treeId/members` | admin | Members and their roles |
| PATCH / DELETE | `/api/trees/:treeId/members/:userId` | admin | `{ role: "admin" \| "editor" \| "viewer", scope?: { rootId, depth } \| null }`, or remove access. `scope` limits an editor to a branch; omitted or null means the whole tree. Admins can only change editors and viewers, and only the owner can grant `admin` (`403`, `code: "ownerOnly"`) |
| GET / POST | `/api/trees/:treeId/invitations` | admin | List, or create `{ email, role: "admin" \| "editor" \| "viewer", scope? }` (sends the email). Only the owner can invite admins |
| GET | `/api/trees/:treeId/branch` | viewer | `{ scope: null }`, or for an editor limited to a branch `{ scope, people: [{ id, level }] }` (`level` is generations below the branch's first person, `null` for spouses) |
| POST | `/api/trees/:treeId/invitations/:id/resend` | admin | New link and expiry, email again (admin invitations: owner only) |
| DELETE | `/api/trees/:treeId/invitations/:id` | admin | Revoke (admin invitations: owner only) |

Error codes:

- `400`: validation failed, a reset link is invalid or expired, or the current password is wrong.
- `401`: no session, a session from before a password change, or the email or password is wrong.
- `403`: role too low, the personal data agreement not accepted (`consentRequired`), email not verified, an invitation meant for another address, or a missing CSRF header.
- `404`: not found, or not a member.
- `409`: the email is already registered, or the person already has access.
- `410`: the invitation has expired.
- `429`: too many login or change-password attempts, or verification emails resent too quickly.
- `502`: the email couldn't be sent.

## 1. Create the AuraDB instance

1. Go to <https://console.neo4j.io> and create an instance. The **AuraDB Free** tier is enough.
2. Download the credentials file it offers. It contains `NEO4J_URI`, `NEO4J_USERNAME` and `NEO4J_PASSWORD`, and the password is shown only once.
3. Wait until the instance status is **Running**.

## 2. Set up email sending (Resend)

Without `RESEND_API_KEY`, the backend **prints emails to its console** instead of sending them. Locally you can copy the verification or invitation link from the terminal. To really send:

1. Create an account at <https://resend.com> and an API key under **API Keys**. Put it in `RESEND_API_KEY`.
2. Under **Domains**, add and verify a domain you own (a few DNS records). Then set `EMAIL_FROM`, e.g. `Family Tree <noreply@yourdomain.com>`.
   - Until a domain is verified, Resend's test sender `onboarding@resend.dev` only delivers to the email address of your own Resend account.

To use another provider (SES, SendGrid, SMTP), change only [`backend/src/email/mailer.ts`](backend/src/email/mailer.ts).

## 3. Create the OAuth apps (optional)

Email and password registration works without this. Callback URLs point at the **frontend** URL, because the frontend proxies `/api/*` to the backend.

**Google**: <https://console.cloud.google.com/apis/credentials>

1. Configure the OAuth consent screen (External; add yourself as a test user while the app is in testing).
2. Create credentials → OAuth client ID → **Web application**.
3. Under Authorized redirect URIs, add:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<frontend>.vercel.app/api/auth/google/callback`
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**GitHub**: <https://github.com/settings/developers> → New OAuth App

1. Set the callback URL to `http://localhost:3000/api/auth/github/callback`.
2. A GitHub app allows only one callback URL, so create a second app for production with `https://<frontend>.vercel.app/api/auth/github/callback`.
3. Copy the values into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

To add another provider, add an entry in [`backend/src/auth/providers.ts`](backend/src/auth/providers.ts).

## 4. Set up photo storage (optional)

Without `PHOTO_STORAGE`, people's photos can only be links. Pick one storage option:

**S3-compatible** (`PHOTO_STORAGE=s3`): AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi…

1. Create a **private** bucket. It doesn't need public access or CORS, because only the backend talks to it.
2. Create an access key that can `PutObject`, `GetObject` and `DeleteObject` in that bucket.
3. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_REGION`. For anything other than AWS, also set `S3_ENDPOINT`. For example, Cloudflare R2 uses `https://<account-id>.r2.cloudflarestorage.com` with `S3_REGION=auto`.

**Google Drive** (`PHOTO_STORAGE=gdrive`):

1. In the Google Cloud console, enable the **Google Drive API** for your project.
2. Create a folder for the photos and copy its id (the last part of its URL) into `GDRIVE_FOLDER_ID`.
3. Choose how the backend signs in:
   - **Service account** (Google Workspace): create a service account and a JSON key, and put the key in `GDRIVE_SERVICE_ACCOUNT_JSON` (as is, or base64-encoded). Service accounts have no storage quota of their own, so the folder must be on a **shared drive**, with the service account's email added as *Content manager*.
   - **Your own Google account** (works with a free Gmail account): get a refresh token with the scope `https://www.googleapis.com/auth/drive`, for example from the [OAuth Playground](https://developers.google.com/oauthplayground) using your own OAuth client. Put it in `GDRIVE_REFRESH_TOKEN`. The client defaults to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; set `GDRIVE_CLIENT_ID`/`GDRIVE_CLIENT_SECRET` to use another one. Publish the OAuth consent screen (**In production**), because refresh tokens issued while it is *Testing* expire after 7 days.

Photos already stored stay where they are if you switch storage later, but the API only reads from the configured one.

## 5. Run locally

Requires Node.js 20 or later.

```powershell
# Backend: http://localhost:4000
cd backend
npm install
copy .env.example .env      # fill in AuraDB, JWT_SECRET, and optionally Resend and OAuth
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # generate a value for JWT_SECRET
npm run db:init             # constraints, indexes and migrations (safe to re-run)
npm run dev
```

```powershell
# Frontend: http://localhost:3000
cd frontend
npm install
copy .env.example .env.local   # API_URL=http://localhost:4000
npm run dev
```

Open <http://localhost:3000> (not port 4000) and click **Register**. Without Resend configured, copy the verification link from the backend terminal.

- **Sample data:** to load a 24-person, five-generation Vietnamese sample family into your private tree, click **Load sample family** on the empty tree, or run `npm run db:seed` in `backend/`. Use `-- --owner someone@example.com` for another user's tree. The family itself is defined in [`backend/src/trees/sampleFamily.ts`](backend/src/trees/sampleFamily.ts).
- **Restarts:** restart `npm run dev` after changing `next.config.ts` or `API_URL`.

**Upgrading from an earlier version:** run `npm run db:init` once. It does the following:

- Creates a private tree for each existing user and moves their people into it.
- Removes the old account roles (`admin`, `user`, …); only per-tree roles remain.
- Marks existing social-login emails as verified.
- Adds the indexes for uploaded photos and email changes.
- Removes the old app-wide `(:Settings)` node; settings are now stored per tree.

Accounts registered earlier with email and password will be asked to verify their email the next time they sign in. Every existing account is asked to accept the personal data agreement at its next sign-in.

## 6. Deploy to Vercel

Create **two Vercel projects** from the same Git repository, one per folder.

### Backend project

- **Root Directory:** `backend`
- **Framework Preset:** Other. `vercel.json` sets this itself (`"framework": null`), so it applies even if Vercel detected the project as Express.
- **How it builds:** Vercel runs `npm run vercel-build`, which compiles the TypeScript with `tsc` into `dist/` and creates `public/` (only a `robots.txt`). `vercel.json` routes every request to `api/index.js`, a plain-JavaScript entry point that loads the compiled Express app from `dist/`. Vercel never compiles TypeScript itself: with TypeScript 7 its own TypeScript step fails (`TS2688: Cannot find type definition file for 'node'`, then "TypeScript did not emit an output").
- **Check it locally before deploying:** `vercel pull --yes` once, then `vercel build --prod`. The output should be `.vercel/output/functions/api/index.func`.
- **Environment variables:**

| Variable | Value |
| --- | --- |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | From the AuraDB credentials file |
| `JWT_SECRET` | A long random string. Use a different one from local development |
| `PUBLIC_APP_URL` | `https://<frontend>.vercel.app`, the **frontend** URL. It's used in email links and OAuth callbacks |
| `RESEND_API_KEY`, `EMAIL_FROM` | From Resend (see step 2) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional, from the production GitHub app |
| `CRON_SECRET` | A long random string. It enables the daily keep-alive and the anniversary reminder emails below |
| `PHOTO_STORAGE` and its `S3_*` or `GDRIVE_*` settings | Optional, for photo uploads (see step 4) |

### Keeping AuraDB Free awake

AuraDB Free pauses an instance that has had no writes for a few days, and deletes it if it then stays paused. To prevent that, `vercel.json` schedules a **Vercel Cron** job every day at 03:00 UTC. The job calls `GET /api/cron/keepalive`, which writes a single `(:Keepalive {id: 'aura-free', pingedAt, count})` node.

- **Auth:** Vercel sends `Authorization: Bearer <CRON_SECRET>` and the endpoint rejects anything else. Without `CRON_SECRET` it answers `503` and writes nothing.
- **Check it:** in the backend project, open **Settings → Cron Jobs** to see the runs or trigger one by hand. Then run `MATCH (k:Keepalive) RETURN k` in the Aura console.
- **Cron jobs** only run on the production deployment. The Hobby plan allows daily jobs, and the exact minute can vary within the hour.

### Anniversary reminder emails

A second daily Vercel Cron job, at 00:00 UTC (07:00 in Vietnam), calls `GET /api/cron/reminders` to email the death anniversary reminders that are due (see [Death anniversary reminders](#death-anniversary-reminders-ngày-giỗ)). It uses the same `CRON_SECRET` auth and needs `RESEND_API_KEY` to really send. It answers `{ date, emails, failed }` and is safe to run again the same day. To try it locally, set `CRON_SECRET` in `backend/.env` and run `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:4000/api/cron/reminders`. Without `RESEND_API_KEY`, the emails are printed to the console.

### Frontend project

- **Root Directory:** `frontend`
- **Framework Preset:** Next.js (detected automatically)
- **Environment variables:**
  - `API_URL=https://<backend>.vercel.app`. The `/api/*` rewrite is generated at build time, so redeploy after changing it.
  - `NEXT_PUBLIC_PRIVACY_CONTROLLER` and `NEXT_PUBLIC_PRIVACY_CONTACT`: who runs the site and an email for personal data requests, shown in the [personal data agreement](#personal-data-agreement-luật-bảo-vệ-dữ-liệu-cá-nhân-912025qh15). Also built in, so redeploy after changing them.

Once both are deployed, open `https://<frontend>.vercel.app/api/health`. It should return `{"status":"ok"}`, which shows the proxy is working.

Sign-in, verification links and invitation links all use `PUBLIC_APP_URL`. Preview deployments on other URLs need their own sign-in.

You can also deploy from the CLI: `npm i -g vercel`, then run `vercel` inside each folder.

## Security notes

- The session token lives only in an HttpOnly cookie. Page scripts can't read it, and it never appears in a URL or in `localStorage`.
- The backend is still reachable at its own `*.vercel.app` URL, but the session cookie belongs to the frontend's domain and is never sent there.
- Changing `JWT_SECRET` signs everyone out immediately.
- Signing out clears the cookie in that browser. Changing or resetting the password signs the account out everywhere else. To cut someone off from your tree, remove them on **Share**.
- The Neo4j driver is a singleton that warm serverless invocations reuse.
- `npm run build && npm start` in `backend/` runs the API as a normal Node server, for example on Render, Railway or Fly.io.
