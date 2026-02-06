<p align="center">
  <img src="https://raw.githubusercontent.com/RioNoir/paramount-stremio/refs/heads/main/public/icon.png" alt="Castoro" style="margin: 20px 0; width: 400px; height: auto;">
</p>
<p align="center">
  <a href="https://www.buymeacoffee.com/rionoir"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="BuyMeACoffee" style="margin: 20px 0; width: 95px; height: auto;"></a>
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/RioNoir/paramount-stremio">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/RioNoir/paramount-stremio">
</p>
<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-20+-orange">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Ready-blue.svg">
  <img alt="HLS" src="https://img.shields.io/badge/HLS-Streaming-red.svg">
</p>

# Unofficial Paramount+ Stremio Addon

> [!WARNING]  
> DISCLAIMER: This project is not associated with Paramount in any way. This project does not provide pirated content in any way, a valid Paramount+ account is required to access content. 

This is an add-on that allows you to view the contents of your Paramount+ account directly within Stremio. To use it, you need to log in with your account. <ins>Currently, only US accounts are supported.</ins>

## ✨ Features

- Account login with Device Code (like TV)
- Automatically generated catalogs/meta, always up to date (currently only live TV and sports)
- Auto-proxed streams directly from the addon (currently only HLS streams work)
- Multiple accounts with a single instance of the addon

## 💾 Installation

Before proceeding with the installation, you must generate a <b>random key</b>, which will be used to encrypt the login session.

Example with OpenSSL:
```
openssl rand -hex 32
```
If you don't have OpenSSL, you can generate a key online, for example [here](https://randomkeygen.com/). <br>
Be sure not to share your key.

---

### ☁️ Deploy on Vercel
If you don't have the option to host the add-on on your own server, you can easily create it with Vercel. Just click on the button below, and remember to configure the environment variables.

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRioNoir%2Fparamount-stremio&env=BASE_URL,KEY_SECRET,TIMEZONE&project-name=paramount-stremio&repository-name=paramount-stremio"><img src="https://vercel.com/button" alt="Deploy with Vercel"/></a>

Please note: On Vercel the add-on may not work due to IP blocking. 

---

### 💻 Manual installation

The following tools are required for manual installation: [git](https://git-scm.com/install/), [node/npm](https://nodejs.org/en/download/current) (20+).

```bash
git clone https://github.com/RioNoir/paramount-stremio.git#main
cd paramount-stremio

###
# Before starting the addon, create an .env file with the required environment variables. See below.
# Example:
# BASE_URL=http://localhost:3000
# KEY_SECRET=[random-key]
###

npm install
npm run start #Starting Addon

#with custom port (optional)
npm run start -- --port 7850
```
By default addon web ui will be available at: `http://localhost:3000`

---

### 🐳 Install with docker build/run

The following tools are required for docker installation: [git](https://git-scm.com/install/), [docker](https://docs.docker.com/engine/install/).

```bash
#Image build
docker build -t paramount-stremio https://github.com/RioNoir/paramount-stremio.git#main

#Start addon
docker run --name Paramount-Stremio -e BASE_URL=http://localhost:7850 -e KEY_SECRET=[random-key] -e TIMEZONE=Europe/Rome -p 7850:7850 -d paramount-stremio
```
Addon web ui will be available at: `http://localhost:7850`

---

### 🐳 Install with docker compose (recommended)

The following tools are required for docker installation: [git](https://git-scm.com/install/), [docker](https://docs.docker.com/engine/install/).<br><br>
**Create a `docker-compose.yml` and enter the following:**

```bash
services:
  paramount-stremio:
    build: https://github.com/RioNoir/paramount-stremio.git#main
    container_name: Paramount-Stremio
    environment:
      - BASE_URL=http://localhost:7850 #required
      - KEY_SECRET=[random-key] #required
      - PORT=7850 #optional (default: 7850)
    restart: unless-stopped
    ports:
      - "7850:7850"
```
**Start addon with `docker compose up -d`** <br>
Addon web ui will be available at: `http://localhost:7860`

---

### 📖 Environment variables

You can configure or set the following environment variables in an `.env` file. This applies to all types of installation.

| Variable | Value | Required | Description |
|:---|:---|:---|:---|
| `BASE_URL` | `http://localhost:7860` | YES | The URL that the app will place in front of all generated links. This can be the link to your proxy server to use HTTPS. |
| `KEY_SECRET` | `[random-key]` | YES | Randomly generated key to encrypt the login session. At least 20 characters recommended. |
| `TIMEZONE` | `America/New_York` | NO | Time zone used to format dates. |
| `FORCE_HQ` | `false` | NO | Set to `true` to force maximum streaming quality, useful in some players. |
| `HTTP_PROXY` | `https://<username>:<password>@us8682.<vpn-provider>.com:89` | NO | HTTP/HTTPS/SOCK5 Proxy, all HTTP calls from addon will be made using this. Currently, only one proxy is supported. |
| `MFP_URL` | `http://localhost:8888` | NO | URL of your [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) instance. |
| `MFP_PASS` | `<your-password>` | NO | Password of your [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) instance. |

---

## 🤝 Contributing

Contributions are welcome! To contribute:

1. **Fork** the repository
2. **Create** a branch for changes (`git checkout -b feature/your-feature`)
3. **Commit** the changes (`git commit -m 'Added your-feature'`)
4. **Push** to the branch (`git push origin feature/your-feature`)
5. **Open** a Pull Request

### 🐛 Bug Reporting

To report bugs, open an issue including:
- Addon version
- Operating system
- Test URL causing the problem
- Full error log

### 💡 Feature Requests

For new features, open an issue describing:
- Desired functionality
- Specific use case
- Priority (low/medium/high)

---

## ⚖️ Legal Disclaimer
This software is provided for educational and research purposes only. The author does not endorse or encourage any form of piracy or violation of the Terms of Service (ToS) of third-party streaming platforms.

No DRM bypass: This software does not include tools to bypass, remove, or violate DRM protections (such as Widevine). It acts solely as a proxy to forward legitimate requests made by a duly subscribed user.

User Responsibility: The end user is solely responsible for the use of the software and must ensure that their use complies with local laws and the contractual terms of the content provider.

No Warranty: The software is provided “as is,” with no warranties of any kind regarding its operation or stability. The author is not responsible for any account suspensions or damages resulting from the use of this code.

Intellectual Property: All trademarks, service names, and logos (e.g., Paramount+) belong to their respective owners. This project is not affiliated with, authorized by, or endorsed by these entities.

## 📄 License

This project is distributed under the MIT license. See the `LICENSE` file for more details.

