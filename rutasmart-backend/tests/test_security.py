"""
Security tests — authentication, password/PIN hashing, backward compatibility.

Maps to ISO/IEC 25010 — Security (confidentiality, integrity, authenticity).

These verify the bcrypt + legacy-SHA256 auth path documented in auth_routes.py.
"""
import hashlib

import pytest

from app.models.user import User, UserRole


@pytest.mark.unit
class TestPasswordHashing:
    def test_bcrypt_hash_is_not_plaintext(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.set_password("Secret123!")
        assert u.password_hash != "Secret123!"
        assert u.password_hash.startswith("$2")  # bcrypt prefix

    def test_correct_password_verifies(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.set_password("Secret123!")
        assert u.verify_password("Secret123!") is True

    def test_wrong_password_rejected(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.set_password("Secret123!")
        assert u.verify_password("wrong") is False

    @pytest.mark.contract
    def test_same_password_produces_different_hashes(self):
        # bcrypt salts each hash — two users with the same password must not
        # share a hash (rainbow-table resistance).
        u1 = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u2 = User(user_id="u2", email="c@d.ph", role=UserRole.ADMIN, display_name="B")
        u1.set_password("SamePass1!")
        u2.set_password("SamePass1!")
        assert u1.password_hash != u2.password_hash


@pytest.mark.unit
class TestLegacyHashBackwardCompat:
    def test_legacy_sha256_still_verifies(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.password_hash = hashlib.sha256("legacy123".encode()).hexdigest()
        assert u.verify_password("legacy123") is True

    def test_legacy_hash_flagged_for_rehash(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.password_hash = hashlib.sha256("legacy123".encode()).hexdigest()
        assert u.needs_password_rehash() is True

    def test_bcrypt_hash_not_flagged_for_rehash(self):
        u = User(user_id="u1", email="a@b.ph", role=UserRole.ADMIN, display_name="A")
        u.set_password("Modern1!")
        assert u.needs_password_rehash() is False


@pytest.mark.unit
class TestPinHashing:
    def test_correct_pin_verifies(self):
        c = User(user_id="c1", employee_id="CDR-2024-042", role=UserRole.CONDUCTOR,
                 display_name="C", jeep_code="JPN-001")
        c.set_pin("1234")
        assert c.verify_pin("1234") is True

    def test_wrong_pin_rejected(self):
        c = User(user_id="c1", employee_id="CDR-2024-042", role=UserRole.CONDUCTOR,
                 display_name="C", jeep_code="JPN-001")
        c.set_pin("1234")
        assert c.verify_pin("9999") is False

    def test_pin_hash_is_not_plaintext(self):
        c = User(user_id="c1", employee_id="CDR-2024-042", role=UserRole.CONDUCTOR,
                 display_name="C", jeep_code="JPN-001")
        c.set_pin("1234")
        assert c.pin_hash != "1234"
