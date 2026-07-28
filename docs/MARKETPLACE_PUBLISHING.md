# Marketplace publishing

ThreadRelink is published as `ascendho.threadrelink`. A GitHub Release whose tag
matches the extension version publishes the VSIX to the Visual Studio
Marketplace and attaches the same package to the GitHub Release.

Marketplace installs receive VS Code extension updates automatically. A
manually installed VSIX does not receive automatic updates by default.

## One-time identity setup

The publishing workflow uses Microsoft Entra ID and GitHub OIDC. It does not
store a Personal Access Token.

1. Sign in to Azure DevOps and the Visual Studio Marketplace with the same
   Microsoft account.
2. Create the Marketplace publisher `ascendho`. Publisher IDs cannot be renamed.
3. In an Azure subscription, create a resource group and a user-assigned managed
   identity:

   ```bash
   az group create \
     --name threadrelink-publishing \
     --location eastus

   az identity create \
     --name threadrelink-marketplace-publisher \
     --resource-group threadrelink-publishing
   ```

4. Give the identity Reader access to the subscription. Replace the
   placeholders with values returned by `az account show` and
   `az identity show`:

   ```bash
   az role assignment create \
     --assignee-object-id <PRINCIPAL_ID> \
     --assignee-principal-type ServicePrincipal \
     --role Reader \
     --scope /subscriptions/<SUBSCRIPTION_ID>
   ```

5. Add a federated credential that trusts only the `marketplace` GitHub
   Environment in this repository:

   ```bash
   az identity federated-credential create \
     --name github-threadrelink-marketplace \
     --identity-name threadrelink-marketplace-publisher \
     --resource-group threadrelink-publishing \
     --issuer https://token.actions.githubusercontent.com \
     --subject 'repo:ascendho@78126591/ThreadRelink@1313819450:environment:marketplace' \
     --audiences api://AzureADTokenExchange
   ```

   This repository uses GitHub's immutable owner and repository IDs in OIDC
   subjects. The numeric IDs remain stable if the owner or repository is
   renamed. A fork or transferred repository must use the subject shown in its
   own GitHub OIDC assertion.

6. Create a GitHub Environment named `marketplace`. Restrict its deployment
   tags to `v*`, then add these non-secret environment variables:

   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`

7. Run **Check Marketplace Publishing Identity** with `verify_access` set to
   `false`. Copy the Marketplace profile ID shown in the workflow summary.
8. In the Marketplace publisher management page, add that profile ID as a
   member of `ascendho` with the Contributor role.
9. Run the identity check again with `verify_access` set to `true`. Do not create
   a release until this check succeeds.

## Publish a version

1. Update `packages/vscode/package.json` to the new `X.Y.Z` version.
2. Add the same version heading to `packages/vscode/CHANGELOG.md`.
3. Run:

   ```bash
   pnpm check
   pnpm check:release-version vX.Y.Z
   pnpm package:vscode
   ```

4. Merge the release commit into `main`.
5. Create and publish a GitHub Release whose tag is exactly `vX.Y.Z`.

The release workflow repeats all checks, attaches `threadrelink.vsix`, and
publishes the same package to the Marketplace. Duplicate workflow retries are
safe because publishing uses `--skip-duplicate`.

## First Marketplace installation

The development VSIX used the old extension ID
`ascendho.threadrelink-vscode`. Uninstall it once, then install the Marketplace
edition:

```bash
code --uninstall-extension ascendho.threadrelink-vscode
code --install-extension ascendho.threadrelink
```

This changes only the installed extension identity. ThreadRelink's registry,
stable project UUIDs, and Codex conversation files are preserved.
