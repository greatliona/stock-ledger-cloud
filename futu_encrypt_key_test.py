import os
import tempfile
import unittest
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from futu_encrypt_key import encrypt_existing

class EncryptKeyTests(unittest.TestCase):
    def test_preserves_key_and_input(self):
        key = Ed25519PrivateKey.generate()
        raw = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder)/"original.pem", Path(folder)/"encrypted.pem"
            source.write_bytes(raw)
            encrypt_existing(source, output, "example-password")
            restored = serialization.load_pem_private_key(output.read_bytes(), b"example-password")
            self.assertEqual(key.public_key().public_bytes_raw(), restored.public_key().public_bytes_raw())
            self.assertEqual(source.read_bytes(), raw)
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                encrypt_existing(source, output, "example-password")
            with self.assertRaises(ValueError):
                encrypt_existing(source, Path(folder)/"bad.pem", "short")
            self.assertFalse((Path(folder)/"bad.pem").exists())

    def test_rejects_public_key(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder)/"public.pem", Path(folder)/"encrypted.pem"
            source.write_bytes(Ed25519PrivateKey.generate().public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
            with self.assertRaises(ValueError):
                encrypt_existing(source, output, "example-password")
            self.assertFalse(output.exists())

if __name__ == "__main__":
    unittest.main()
