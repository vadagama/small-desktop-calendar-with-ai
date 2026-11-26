"""Verify the persisted installer layout and the signed application, headlessly."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from ds_store import DSStore


def run(*args):
    subprocess.run(args, check=True)


def verify(image):
    with tempfile.TemporaryDirectory(prefix="ordo-dmg-check-") as work:
        mount = Path(work) / "volume"
        mount.mkdir()
        run("/usr/bin/hdiutil", "attach", str(image), "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", str(mount))
        try:
            assert {p.name for p in mount.iterdir()} == {"Ordo.app", "Applications", ".DS_Store", ".VolumeIcon.icns", ".background.tiff"}, "Unexpected installer contents"
            assert os.readlink(mount / "Applications") == "/Applications"
            app = mount / "Ordo.app"
            run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
            icon = mount / ".VolumeIcon.icns"
            assert icon.read_bytes() == (app / "Contents/Resources/ordo.icns").read_bytes(), "Volume icon differs from Ordo"
            finder = bytes.fromhex(subprocess.check_output(["/usr/bin/xattr", "-px", "com.apple.FinderInfo", str(mount)], text=True))
            assert int.from_bytes(finder[8:10], "big") & 0x0400, "Custom volume icon flag missing"
            with DSStore.open(str(mount / ".DS_Store"), "r") as store:
                assert store["Ordo.app"]["Iloc"] == (170, 190), "App must be on the left"
                assert store["Applications"]["Iloc"] == (470, 190), "Applications must be on the right"
                window = store["."]["bwsp"]
                assert window["WindowBounds"] == "{{120, 120}, {640, 400}}"
                assert not any(window[k] for k in ["ShowToolbar", "ShowStatusBar", "ShowSidebar", "ShowPathbar"])
                options = store["."]["icvp"]
                assert options["iconSize"] == 96 and options["textSize"] == 12
                assert options["backgroundType"] == 2 and options["backgroundImageAlias"]
                assert options["arrangeBy"] == "none"
            if os.environ.get("ORDO_DMG_SMOKE") == "1":
                profile = Path(work) / "clean-profile"
                profile.mkdir(mode=0o700)
                installed = Path(work) / "Ordo.app"
                run("/usr/bin/ditto", str(app), str(installed))
                run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(installed))
                run(str(installed / "Contents/MacOS/small-calendar"), "-smoke", "-user-data-dir", str(profile))
            print("PASS: installer layout, background, Applications link, volume icon and strict app signature")
        finally:
            for attempt in range(12):
                result = subprocess.run(["/usr/bin/hdiutil", "detach", str(mount)], capture_output=True, text=True)
                if result.returncode == 0:
                    break
                if attempt == 11:
                    raise RuntimeError(result.stderr)
                time.sleep(1)
    print("SHA256:", hashlib.sha256(image.read_bytes()).hexdigest())


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())
