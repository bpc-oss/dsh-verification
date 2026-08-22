import os, re, sys, shutil

SRC_ROOTS = sys.argv[1:] if len(sys.argv) > 1 else [
    r"C:\Users\bpshi\asi-all-std", r"C:\Users\bpshi\asi-all-enf",
    r"C:\Users\bpshi\asi-all-rsi", r"C:\Users\bpshi\asi-all-min",
    r"C:\Users\bpshi\asi-all-mask",
]
OUT = r"C:\Users\bpshi\release-scrubbed"

KEY_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_\-]{20,}"), "[REDACTED_KEY]"),
    (re.compile(r"hf_[A-Za-z0-9]{20,}"), "[REDACTED_HF]"),
]
PII_PATTERNS = [
    (re.compile(r"C:\\Users\\[A-Za-z0-9_\-]+", re.IGNORECASE), "C:\\Users\\<user>"),
    (re.compile(r"100\.10[0-9]\.[0-9]{1,3}\.[0-9]{1,3}"), "[TAILSCALE_IP]"),
    (re.compile(r"192\.168\.[0-9]{1,3}\.[0-9]{1,3}"), "[LAN_IP]"),
]

def scrub_text(s):
    for pat, rep in KEY_PATTERNS + PII_PATTERNS:
        s = pat.sub(rep, s)
    return s

def scrub_file(src, dst):
    ext = os.path.splitext(src)[1].lower()
    if ext in (".json", ".log", ".txt", ".md", ".yml", ".yaml", ".py", ".csv", ".ps1"):
        try:
            with open(src, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            content = scrub_text(content)
            with open(dst, "w", encoding="utf-8") as f:
                f.write(content)
            return "text"
        except Exception:
            pass
    shutil.copy2(src, dst)
    return "binary"

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    total = 0
    text = 0
    for root in SRC_ROOTS:
        if not os.path.isdir(root):
            print("skip missing: " + root, flush=True)
            continue
        base = os.path.basename(root)
        for dirpath, dirnames, filenames in os.walk(root):
            for fn in filenames:
                src = os.path.join(dirpath, fn)
                rel = os.path.relpath(src, root)
                dst = os.path.join(OUT, base, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                kind = scrub_file(src, dst)
                total += 1
                if kind == "text":
                    text += 1
    print("SCRUB DONE: %d files (%d text, %d binary) -> %s" % (total, text, total - text, OUT), flush=True)

if __name__ == "__main__":
    main()