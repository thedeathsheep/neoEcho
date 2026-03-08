# 上传 neoEcho 到 GitHub

本地已完成首次提交，按下面步骤推送到你的 GitHub。

## 1. 在 GitHub 上创建新仓库

1. 打开 https://github.com/new
2. **Repository name** 填：`neoEcho`（或你喜欢的名字）
3. 选 **Public**，**不要**勾选 "Add a README"（本地已有代码）
4. 点击 **Create repository**

## 2. 添加远程并推送

在项目根目录 `d:\projects\neoEcho` 打开终端，把下面命令里的 `YOUR_USERNAME` 换成你的 GitHub 用户名，`REPO_NAME` 换成仓库名（若用 neoEcho 就写 neoEcho）：

```powershell
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

若使用 SSH：

```powershell
git remote add origin git@github.com:YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

## 3. 若仓库已存在且已有 origin

若你之前已经添加过 `origin`，先查看：

```powershell
git remote -v
```

若要改成新仓库地址：

```powershell
git remote set-url origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git push -u origin main
```

完成以上步骤后，代码就会出现在你的 GitHub 仓库中。
