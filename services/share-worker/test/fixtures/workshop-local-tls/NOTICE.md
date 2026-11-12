# 公开回环 TLS 测试材料

本目录证书和私钥故意公开，只供 `scripts/workshop-e2e.mjs` 的本机 HTTPS 假论坛、Worker 和测试客户端使用。它们不是用户、论坛或 Cloudflare 凭据，不应装到系统信任库，也不得用于真实服务。

- Subject：`CN=dsh-workshop-local-test-only`。
- SAN：仅 `IP Address:127.0.0.1`。
- 自签 CA，RSA 2048、SHA-256，允许 serverAuth。
- 有效期：2026-11-12 03:02:38 UTC 至 2126-10-19 03:02:38 UTC。客户端仍核验证书与主机；错误系统时间会使演练失败。
- Node Agent、Dart 独立 SecurityContext、Worker 子进程的信任只用于本次演练。

材料由已有 OpenSSL 生成，运行演练不需要 OpenSSL。重建命令：

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -sha256 \
  -subj /CN=dsh-workshop-local-test-only \
  -addext subjectAltName=IP:127.0.0.1 \
  -addext basicConstraints=critical,CA:TRUE \
  -addext keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign \
  -addext extendedKeyUsage=serverAuth \
  -keyout localhost-key.pem -out localhost-cert.pem
```

不要换成私有证书／密钥后提交。真实部署继续使用正常 TLS 和管理密钥配置。
