<p align="center">
<img src="https://raw.githubusercontent.com/RioNoir/paramount-stremio/refs/heads/main/public/icon.png" alt="Castoro" style="margin: 20px 0; width: 400px; height: auto;">
</p>
<p align="center">
<a href="https://www.buymeacoffee.com/rionoir"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="BuyMeACoffee" style="margin: 20px 0; width: 95px; height: auto;"></a>
<img alt="GitHub forks" src="https://img.shields.io/github/forks/RioNoir/paramount-stremio">
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/RioNoir/paramount-stremio">

</p>

# Unofficial Paramount+ Stremio Addon

> [!WARNING]  
> DISCLAIMER: This project is not associated with Paramount in any way. This project does not provide pirated content in any way, a valid Paramount+ US account is required to access content. 

This is an add-on that allows you to view the contents of your Paramount+ account directly within Stremio. To use it, you need to log in with your account. Currently, only US accounts are supported.

## Getting Started



## Installation

Before proceeding with the installation, you must generate a <b>random key</b>, which will be used to encrypt the login session.

E.g. with OpenSSL 
```
openssl rand -hex 32
```
If you don't have OpenSSL, you can generate a key online, for example [here](https://randomkeygen.com/). <br>
Be sure not to share your key.

### Deploy on Vercel
If you don't have the option to host the add-on on your own server, you can easily create it with Vercel. Just click on the button below, and remember to configure the environment variables.

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRioNoir%2Fparamount-stremio&env=BASE_URL,KEY_SECRET,TIMEZONE&project-name=paramount-stremio&repository-name=paramount-stremio"><img src="https://vercel.com/button" alt="Deploy with Vercel"/></a>

### Manual installation

```bash
git clone https://github.com/RioNoir/paramount-stremio.git#main
cd paramount-stremio

npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

### Install with docker build/run

```
docker build -t paramount-stremio https://github.com/RioNoir/paramount-stremio.git#main

docker run --name Paramount-Stremio -e BASE_URL=http://localhost:7850 -e KEY_SECRET=[random-key] -e TIMEZONE=Europe/Rome -p 3000:3000 -d paramount-stremio
```

### Install with docker compose (recommended)

```
services:
  paramount-stremio:
    build: https://github.com/RioNoir/paramount-stremio.git#main
    container_name: Paramount-Stremio
    environment:
      - BASE_URL=http://localhost:7850
      - PORT=7850
      - KEY_SECRET=[random-key]
    restart: unless-stopped
    ports:
      - "7850:7850"
```



