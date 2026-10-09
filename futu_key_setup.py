"""Run locally to generate encrypted Ed25519 credentials; never prints secrets."""
import getpass
import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main():
    root = Path(__file__).resolve().parent / ".futu-private"
    if root.exists():
        raise SystemExit("已有 .futu-private，為避免覆蓋既有金鑰已停止。")
    password = getpass.getpass("設定私鑰密碼（至少 12 字元，不會顯示）：")
    if len(password) < 12 or password != getpass.getpass("再輸入一次："):
        raise SystemExit("密碼太短或不一致；未建立金鑰。")
    key = Ed25519PrivateKey.generate()
    root.mkdir(mode=0o700)
    files = {
        "private.encrypted.pem": key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(password.encode())),
        "public.pem": key.public_key().public_bytes(serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo),
    }
    for name, data in files.items():
        with os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as file:
            file.write(data)
    print("已建立加密金鑰：" + str(root))
    print("只將 public.pem 上傳富途；private.encrypted.pem 只填到伺服器 Secrets。")
    print("密碼沒有儲存，請自行安全保管。下一步請閱讀 FUTU_SETUP.md。")


if __name__ == "__main__":
    main()
