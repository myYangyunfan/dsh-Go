import sys
import glob
import xml.etree.ElementTree as ET

# Temporary helper for reverse-019. usage: junit.py <label> <dir> <class-substring> <case-name>...
label, d, cls_sub = sys.argv[1:4]
want = sys.argv[4:]
files = sorted(glob.glob(d + "/TEST-*.xml"))
print("R019 %s: junit files=%d" % (label, len(files)))
tot = dict(suites=0, tests=0, failures=0, errors=0, skipped=0)
found = {}
bad = []
for f in files:
    root = ET.parse(f).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    for s in suites:
        tot["suites"] += 1
        for k in ("tests", "failures", "errors", "skipped"):
            tot[k] += int(s.get(k) or 0)
        for c in s.iter("testcase"):
            state = "pass"
            body = ""
            for kind in ("failure", "error", "skipped"):
                n = c.find(kind)
                if n is not None:
                    state = kind
                    body = (n.text or n.get("message") or "")
                    break
            cls = c.get("classname") or ""
            if state in ("failure", "error"):
                bad.append((cls, c.get("name")))
            if cls_sub in cls and c.get("name") in want:
                found[c.get("name")] = (cls, state, body, c.get("time"))
print("R019 %s: total suites=%d tests=%d failures=%d errors=%d skipped=%d" % (label, tot["suites"], tot["tests"], tot["failures"], tot["errors"], tot["skipped"]))
missing = 0
for name in want:
    if name not in found:
        print("R019 %s: case %s NOT FOUND in XML" % (label, name))
        missing += 1
        continue
    cls, state, body, t = found[name]
    print("R019 %s: case %s.%s state=%s time=%s" % (label, cls, name, state, t))
    if state in ("failure", "error"):
        for line in body.splitlines()[:25]:
            print("R019 %s: stack| %s" % (label, line))
for cls, name in bad:
    print("R019 %s: FAIL %s.%s" % (label, cls, name))
if missing or bad or any(v[1] != "pass" for v in found.values()):
    sys.exit(3)
