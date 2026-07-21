# Third Kit — Admin Access Checklist

Hand this page to whoever holds the admin account (or follow it yourself if
that's you). It covers everything the integration needs, in one sitting —
roughly 20–30 minutes.

## Roles the admin account needs

| Where | Role needed |
|---|---|
| Microsoft Entra | **Global Administrator** or **Application Administrator** (to register the app and grant consent) |
| Business Central | **SUPER** permission set in the company used for Third Kit |
| Azure | Owner/Contributor on the subscription, or just on one resource group for the Function App |

If one person has all three (common in small companies), this is one session.

---

## A. In Microsoft Entra admin center (entra.microsoft.com)

1. **App registrations → New registration**
   - Name: `ThirdKit-BC-Middleware`
   - Supported account types: single tenant (default). No redirect URI.
2. On the app's **Overview** page, write down:
   - ☐ **Application (client) ID** → `CLIENT_ID`
   - ☐ **Directory (tenant) ID** → `TENANT_ID`
3. **Certificates & secrets → New client secret**
   - Expiry: 24 months (set a calendar reminder to renew it).
   - ☐ Copy the secret **Value** immediately (shown only once) → `CLIENT_SECRET`
4. **API permissions → Add a permission → Dynamics 365 Business Central →
   Application permissions →** tick `API.ReadWrite.All` → Add.
5. Click **Grant admin consent for <organization>** → status turns green.

> Security: don't email or message the secret value around. Best practice is
> that the admin pastes it directly into the Azure Function App's environment
> variables (step C) and stores a copy in a password manager.

## B. In Business Central

1. Search (Alt+Q / magnifying glass) for **"Microsoft Entra Applications"** →
   **New**:
   - Client ID: paste the `CLIENT_ID` from A.2
   - Description: `Third Kit website middleware`
   - State: **Enabled**
2. Under **User Permission Sets** on that card, add:
   - `D365 BASIC`
   - `D365 SALES DOC, EDIT`
   - (or temporarily `D365 FULL ACCESS` to get going, then tighten)
3. Write down:
   - ☐ **Environment name** (admin.businesscentral.dynamics.com → Environments;
     usually `Production`) → `BC_ENVIRONMENT`
   - ☐ **Which company** Third Kit should book into (Settings → My Settings →
     Company). The middleware needs its ID; if the admin doesn't know it,
     leave it and we verify it from the API after deployment → `BC_COMPANY_ID`

## C. In Azure (portal.azure.com)

Either the admin does step 3.1–3.3 of the main GUIDE.md themselves (create the
Function App, deploy the `middleware/` folder, paste the environment
variables), **or** they grant you access to do it:

1. **Resource groups → Create** e.g. `rg-thirdkit`
2. On that resource group → **Access control (IAM) → Add role assignment** →
   role **Contributor** → assign to your user account.

That gives you room to create and manage the Function App without touching
anything else in the subscription.

## D. Checkout provider

- ☐ Login (or an invite) to the checkout provider's dashboard, with rights to
  configure **webhooks / order notifications**.

---

## What you should have at the end

```
TENANT_ID        = ________________________________
CLIENT_ID        = ________________________________
CLIENT_SECRET    = (in password manager / pasted into Azure only)
BC_ENVIRONMENT   = Production
BC_COMPANY_ID    = ________________ (or verified after first deploy)
Azure access     = Contributor on rg-thirdkit (or admin deploys)
Checkout access  = webhook settings available
```

With those in hand, continue at **Phase 3** of GUIDE.md.
