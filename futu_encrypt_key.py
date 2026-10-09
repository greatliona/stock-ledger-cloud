"""Encrypt an existing key without changing its public key. No network calls."""
import getpass
import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def encrypt_existing(source, destination, password, old_password=None):
    if len(password) < 12:
        raise ValueError("新密碼至少需要 12 字元。")
    raw = Path(source).read_bytes()
    try:
        key = serialization.load_pem_private_key(raw, password=old_password)
    except (ValueError, TypeError):
        raise ValueError("不是有效的 PEM 私鑰，或原密碼不正確。不要使用 public.pem 公鑰。") from None
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("目前帳本使用 Ed25519；此私鑰演算法不符，尚未修改任何檔案。")
    encrypted = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                 serialization.BestAvailableEncryption(password.encode()))
    # Exclusive creation prevents replacing the input or any existing encrypted key.
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(encrypted)


def main():
    print("請提供原本與富途 AppKey 配對的私鑰檔。不要使用公鑰、不會重新產生金鑰。")
    path = input("將私鑰檔拖到此終端機（或輸入完整路徑），按 Enter：").strip()
    # macOS dragging adds shell backslash escapes; quoted paths are also accepted.
    import shlex
    try:
        source = Path(path).expanduser()
        if not source.is_file():
            paths = shlex.split(path)
            if len(paths) != 1:
                raise ValueError
            source = Path(paths[0]).expanduser()
        raw = source.read_bytes()
    except (OSError, ValueError):
        raise SystemExit("找不到私鑰檔，未修改任何檔案。") from None
    old_password = None
    if b"ENCRYPTED" in raw:
        old_password = getpass.getpass("原私鑰密碼：").encode()
    password = getpass.getpass("設定新的私鑰密碼（至少 12 字元）：")
    if password != getpass.getpass("再輸入一次："):
        raise SystemExit("兩次密碼不同，未修改任何檔案。")
    root = Path(__file__).resolve().parent / ".futu-private"
    root.mkdir(mode=0o700, exist_ok=True)
    output = root / "existing.encrypted.pem"
    try:
        encrypt_existing(source, output, password, old_password)
    except FileExistsError:
        raise SystemExit("existing.encrypted.pem 已存在；為保護原檔已停止，請先確認既有檔案。") from None
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from None
    print("加密完成，公鑰配對不變，原始檔未修改。")
    print("輸出：" + str(output))
    print("把此檔全文填入 Secrets 的 private_key_pem，新密碼填入 private_key_password。")
    print("AppKey 不變；不要把私鑰或密碼貼到聊天或 GitHub。")


if __name__ == "__main__":
    main()
