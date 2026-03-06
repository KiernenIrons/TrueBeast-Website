with open('admin/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

print("old_fn found:", '/* ── Text emoji picker (for textareas) ── */' in content)
print("dcToggleTextPicker occurrences:", content.count('dcToggleTextPicker'))
