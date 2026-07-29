# Marketplace 发布

ThreadRelink 以 `ascendho.threadrelink` 发布。创建与扩展版本一致的 GitHub
Release 后，自动化工作流会把 VSIX 发布到 Visual Studio Marketplace，并将同一
文件添加到 GitHub Release。

通过 Marketplace 安装的扩展会随 VS Code 自动更新。手动安装的 VSIX 默认不会
自动更新。

## 一次性身份配置

发布工作流使用 Microsoft Entra ID 和 GitHub OIDC，不保存 Personal Access
Token。

1. 使用同一个 Microsoft 账户登录 Azure DevOps 和 Visual Studio Marketplace。
2. 创建 Marketplace publisher `ascendho`。Publisher ID 创建后无法修改。
3. 在 Azure subscription 中创建 resource group 和 user-assigned managed
   identity：

   ```bash
   az group create \
     --name threadrelink-publishing \
     --location eastus

   az identity create \
     --name threadrelink-marketplace-publisher \
     --resource-group threadrelink-publishing
   ```

4. 为该 identity 授予 subscription 的 Reader 权限。将占位符替换为
   `az account show` 和 `az identity show` 返回的值：

   ```bash
   az role assignment create \
     --assignee-object-id <PRINCIPAL_ID> \
     --assignee-principal-type ServicePrincipal \
     --role Reader \
     --scope /subscriptions/<SUBSCRIPTION_ID>
   ```

5. 添加 federated credential，只信任本仓库的 `marketplace` GitHub
   Environment：

   ```bash
   az identity federated-credential create \
     --name github-threadrelink-marketplace \
     --identity-name threadrelink-marketplace-publisher \
     --resource-group threadrelink-publishing \
     --issuer https://token.actions.githubusercontent.com \
     --subject 'repo:ascendho@78126591/ThreadRelink@1313819450:environment:marketplace' \
     --audiences api://AzureADTokenExchange
   ```

   OIDC subject 使用 GitHub 不可变的 owner ID 和 repository ID。即使 owner
   或仓库改名，这些数字 ID 也不会变化。Fork 或转移仓库后，必须改用该仓库自身
   GitHub OIDC assertion 中的 subject。

6. 创建名为 `marketplace` 的 GitHub Environment，将 deployment tag 限制为
   `v*`，并添加以下非敏感环境变量：

   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`

7. 运行 **Check Marketplace Publishing Identity**，将 `verify_access` 设置为
   `false`，并复制 workflow summary 中显示的 Marketplace profile ID。
8. 在 Marketplace publisher 管理页面中，将该 profile ID 添加为 `ascendho`
   的 Contributor。
9. 再次运行身份检查，将 `verify_access` 设置为 `true`。检查成功前不要创建
   Release。

## Azure Free Trial 到期后的备用方案

Marketplace 发布本身不会消耗 Azure Free Trial 额度，但当前的 user-assigned
managed identity 是 Azure subscription 中的资源。Free Trial 到期后，先手动运行
**Check Marketplace Publishing Identity**，并将 `verify_access` 设置为 `true`：

- 如果检查成功，继续使用当前 identity，不做迁移。
- 如果检查因为 subscription 已禁用而失败，再迁移到不依赖 subscription 的
  Microsoft Entra app registration。

迁移时使用现有 GitHub OIDC issuer、不可变 subject 和 audience 创建 app
federated credential，将 GitHub Environment 中的 `AZURE_CLIENT_ID` 改为新
application client ID，并在两个工作流的 `azure/login` 步骤中删除
`subscription-id`、添加 `allow-no-subscriptions: true`。先以
`verify_access: false` 取得新 identity 的 Marketplace profile ID，将其添加为
publisher Contributor，再以 `verify_access: true` 验证访问。

只有新 identity 成功发布一个版本后，才移除旧 Marketplace Contributor，并删除
旧 managed identity 和空 resource group。不要仅因为 Free Trial 即将到期就升级为
按量付费订阅。

## 发布新版本

1. 将 `packages/vscode/package.json` 更新为新的 `X.Y.Z` 版本。
2. 在 `packages/vscode/CHANGELOG.md` 中添加相同的版本标题。
3. 运行：

   ```bash
   pnpm check
   pnpm check:release-version vX.Y.Z
   pnpm package:vscode
   ```

4. 将 release commit 合并到 `main`。
5. 创建并发布 Tag 恰好为 `vX.Y.Z` 的 GitHub Release。

Release 工作流会重新执行全部检查、附加 `threadrelink.vsix`，并将同一个包发布到
Marketplace。发布命令使用 `--skip-duplicate`，因此重复运行工作流是安全的。
