# Збірка Bruno під Ubuntu (на Ubuntu)

Покрокова інструкція: як зібрати `.deb` / AppImage з вихідного коду на Ubuntu.

## 0. Системні залежності

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  python3 \
  git \
  curl \
  ca-certificates \
  libgtk-3-0 \
  libnotify4 \
  libnss3 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  libatspi2.0-0 \
  libuuid1 \
  libsecret-1-0 \
  libasound2 \
  rpm \
  fakeroot
```

`rpm` потрібен лише якщо збираєте `.rpm`. Для `.deb` / AppImage достатньо `fakeroot`.

## 1. Node.js 22.12.0 (через nvm)

У проєкті зафіксовано Node **v22.12.0** (див. `.nvmrc`).

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc   # або перезапустіть термінал

nvm install 22.12.0
nvm use 22.12.0
node -v   # має бути v22.12.0
npm -v
```

## 2. Перейти в репозиторій

```bash
cd /шлях/до/my_bruno
```

## 3. Встановити залежності і зібрати пакети

```bash
nvm use
npm i --legacy-peer-deps
npm run setup
```

`npm run setup` збирає graphql-docs, query, common, converters, requests, schema-types, filestore, sqlite і sandbox.

## 4. Зібрати веб-частину (renderer)

```bash
npm run build:web
```

## 5. Зібрати Electron-дистрибутив

Локальна збірка без підпису:

```bash
export BRUNO_UNSIGNED=1
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

**AppImage:**

```bash
npm run build:electron
```

або явно:

```bash
npm run build:electron:linux
```

**`.deb` (для Ubuntu/Debian):**

```bash
npm run build:electron:deb
```

**`.rpm` (за потреби):**

```bash
npm run build:electron:rpm
```

## 6. Де лежать артефакти

```bash
ls -la packages/bruno-electron/out/
```

Приклади імен файлів:

- `bruno_*_x64_linux.AppImage`
- `bruno_*_x64_linux.deb`

## 7. Встановлення / запуск

**AppImage:**

```bash
chmod +x packages/bruno-electron/out/bruno_*_linux.AppImage
./packages/bruno-electron/out/bruno_*_linux.AppImage
```

**deb:**

```bash
sudo apt install ./packages/bruno-electron/out/bruno_*_linux.deb
```

## Короткий «скопіюй і виконай» (deb + AppImage)

```bash
# системні пакети (один раз)
sudo apt update && sudo apt install -y build-essential python3 git curl ca-certificates \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 \
  libuuid1 libsecret-1-0 libasound2 fakeroot

# node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22.12.0 && nvm use 22.12.0

# зібрати
cd ~/шлях/до/my_bruno
nvm use
npm i --legacy-peer-deps
npm run setup
npm run build:web

export BRUNO_UNSIGNED=1
export CSC_IDENTITY_AUTO_DISCOVERY=false

npm run build:electron:deb      # .deb
# або
npm run build:electron:linux    # AppImage

ls -la packages/bruno-electron/out/
```

## Якщо щось піде не так

- **Wrong Node version** → `nvm use` (у проєкті `.nvmrc` = `v22.12.0`)
- **Помилки peer deps** → завжди `npm i --legacy-peer-deps`
- **Немає `packages/bruno-app/dist`** → спочатку `npm run build:web`
- **Чистий переустанов залежностей:**

```bash
npm run setup
```

Для Ubuntu найкорисніший артефакт — **`.deb`** (`build:electron:deb`). AppImage зручний, якщо не потрібно ставити через apt.
