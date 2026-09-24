# Firebase rules for /pa-naurah

Neither file deploys itself. Paste each into the Firebase console for project **automathtics**,
or ship them with the CLI.

## 1. Create the sign-in account

Firebase console → **Authentication** → **Sign-in method** → enable **Email/Password** (if it is
not already), then **Users** → **Add user**:

- email: `pa-naurah@automathtics.app`
- password: `230867`

The PIN is never written into the page. What the keypad types is used as this account's password,
so a wrong PIN gets no token and therefore no data at all. Changing the PIN later means changing
this password — nothing in the code.

## 2. Realtime Database rules

Console → **Realtime Database** → **Rules** → Publish. Note that Firestore rules are a *different*
screen; pasting there leaves this database on its old rules and every read fails with
`permission_denied at /pa/naurah/days`.

Matched on the account's UID rather than its email: exact, and independent of which claims the
token happens to carry. The UID is not a credential — a token carrying it still requires the
password, which is the PIN. Find it under Authentication → Users if the account is ever recreated.

```json
{
  "rules": {
    "families": {
      "$family": {
        "kumon": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    },
    "pa": {
      "naurah": {
        ".read":  "auth.uid === 'z2HMZKfuLaZkrUPoe32f6iRPRtn1'",
        ".write": "auth.uid === 'z2HMZKfuLaZkrUPoe32f6iRPRtn1'"
      }
    }
  }
}
```

Scoping to that one account matters: the game signs its players in against the same project, so a
bare `auth != null` would let any player read the hotel data through the API.

## 3. Storage rules

Console → **Storage** → **Rules** → Publish. A third separate screen again.

`read` and `write` must NOT share one condition. `request.resource` exists only on a write and is
null on a read, so a combined rule that inspects `request.resource.size` fails every read — uploads
would succeed and then every thumbnail would come back broken. Keep them split:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /pa/naurah/{allPaths=**} {
      allow read: if request.auth != null
        && request.auth.uid == 'z2HMZKfuLaZkrUPoe32f6iRPRtn1';
      allow create, update: if request.auth != null
        && request.auth.uid == 'z2HMZKfuLaZkrUPoe32f6iRPRtn1'
        && request.resource.size < 25 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null
        && request.auth.uid == 'z2HMZKfuLaZkrUPoe32f6iRPRtn1';
    }
  }
}
```

## 4. Authorised domain

Console → **Authentication** → **Settings** → **Authorised domains** → add `gavgunawan.github.io`.
Without it, sign-in from the live site is rejected even with the right PIN. `automathtics.net` points at
Firebase Hosting, not GitHub Pages, so it does not serve this page today — add that domain too only
once the page is actually deployed there.
