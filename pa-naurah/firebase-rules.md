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

Console → **Realtime Database** → **Rules**. Merge the `pa` block into the existing rules; do not
drop the `families` block the game uses.

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
        ".read":  "auth != null && auth.token.email === 'pa-naurah@automathtics.app'",
        ".write": "auth != null && auth.token.email === 'pa-naurah@automathtics.app'"
      }
    }
  }
}
```

Scoping to that one email matters: the game signs players in too, so a bare `auth != null` would
let any player read the hotel data through the API.

## 3. Storage rules

Console → **Storage** → **Rules**.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /pa/naurah/{allPaths=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email == 'pa-naurah@automathtics.app'
        && request.resource.size < 25 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

## 4. Authorised domain

Console → **Authentication** → **Settings** → **Authorised domains** → add `automathtics.net`.
Without it, sign-in from the live site is rejected even with the right PIN.
