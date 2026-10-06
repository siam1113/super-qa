"""Bounded, read-only framework discovery and deterministic test compilation."""
import hashlib
import json
import os
import re
from pathlib import Path

from .contracts import SkillBlocked
from .scope import require_resource
from .operations import operation


def project_root(repository_id, project_path="."):
    require_resource("repositories", repository_id)
    configured = json.loads(os.getenv("QA_REPOSITORIES", "{}"))
    if not isinstance(configured, dict) or not isinstance(configured.get(repository_id), str):
        raise SkillBlocked("Repository is not configured in QA_REPOSITORIES: " + repository_id)
    base = Path(configured[repository_id]).resolve(strict=True)
    path = confined(base, project_path)
    if not path.is_dir():
        raise SkillBlocked("Project directory does not exist")
    return path


def confined(root, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Paths must be relative and cannot traverse parent directories")
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise ValueError("Path escapes configured repository")
    return target


@operation("read_repository_file", "Read a bounded UTF-8 source file inside the configured repository.")
def read_source(root, path, limit=32000):
    target = confined(root, path)
    if not target.is_file() or target.stat().st_size > limit:
        raise SkillBlocked("Source file is missing or exceeds its read budget: " + str(path))
    return target.read_text(encoding="utf-8")


@operation("scan_repository_files", "List repository files within a fixed scan budget, skipping dependencies, build output, and symlinks.")
def scan_repository_files(root):
    paths = []
    scanned = 0
    directories = 0
    truncated = False
    for directory, children, names in os.walk(root, followlinks=False):
        directories += 1
        if directories > 4000:
            truncated = True
            break
        children[:] = sorted(name for name in children if name not in {"node_modules", "dist", "build", "coverage", "test-results", "playwright-report"} and not name.startswith(".") and not (Path(directory) / name).is_symlink())
        for name in sorted(names):
            scanned += 1
            if scanned > 4000:
                truncated = True
                break
            path = Path(directory) / name
            if path.is_symlink():
                continue
            relative = path.relative_to(root).as_posix()
            paths.append(relative)
        if truncated:
            break
    return paths, truncated


@operation("read_framework_profile", "Identify framework configuration, scripts, sample tests, and fixture imports.",
           dependencies=("read_repository_file", "scan_repository_files"))
def inspect_framework(value):
    root = project_root(value.repository_id, value.project_path)
    package = json.loads(read_source(root, "package.json")) if (root / "package.json").is_file() else {}
    dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    frameworks = []
    for framework, packages in (("playwright", ("@playwright/test", "playwright")), ("cypress", ("cypress",))):
        if any(name in dependencies for name in packages):
            frameworks.append(framework)
    paths, truncated = scan_repository_files(root)
    configurations = [path for path in paths if re.fullmatch(r"(playwright|cypress)\.config\.(ts|js|mjs|cjs)", Path(path).name)]
    frameworks = sorted(set(frameworks) | {Path(path).name.split(".")[0] for path in configurations})
    files = [path for path in paths if re.search(r"\.(spec|test|cy)\.(ts|js|tsx|jsx)$", path)][:20]
    samples = []
    for path in files:
        try:
            content = read_source(root, path)
        except SkillBlocked:
            continue
        imports = re.findall(r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]", content)
        test_imports = [module for names, module in imports if re.search(r"\btest\b", names)]
        samples.append({"path": path, "sha256": hashlib.sha256(content.encode()).hexdigest(), "test_imports": test_imports})
    return {"repository_id": value.repository_id, "project_path": value.project_path,
            "frameworks": sorted(frameworks), "config_files": configurations, "samples": samples,
            "package_scripts": package.get("scripts", {}), "scan_truncated": truncated,
            "custom_test_imports": sorted({module for sample in samples for module in sample["test_imports"] if module != "@playwright/test"}),
            "note": "Configuration is inspected as data; scripts and configuration code are never executed."}


@operation("compile_test_source", "Compile concrete actions and assertions into test source and a new-file patch; does not write or run files.")
def generate_automation(value, profile):
    framework = value.framework
    if framework is None:
        if len(profile["frameworks"]) != 1:
            raise SkillBlocked("Choose a framework explicitly; discovery found zero or multiple frameworks")
        framework = profile["frameworks"][0]
    if framework not in profile["frameworks"]:
        raise SkillBlocked("Selected framework was not found in this project")
    root = project_root(value.repository_id, value.project_path)
    target = confined(root, value.test_file)
    if target.exists():
        raise SkillBlocked("The output file already exists; choose a new path to avoid overwriting repository work")
    if not re.fullmatch(r"[a-zA-Z0-9_./-]+\.(spec|test|cy)\.(ts|js)", value.test_file):
        raise ValueError("Use a relative .spec, .test, or .cy TypeScript/JavaScript filename")
    quote = lambda text: json.dumps(text, ensure_ascii=True)
    lines = []
    if framework == "playwright":
        if profile["custom_test_imports"] and not value.test_import:
            raise SkillBlocked("Custom fixtures were detected. Supply test_import relative to the new test file after reviewing existing tests")
        module = value.test_import or "@playwright/test"
        if module != "@playwright/test":
            if not module.startswith("."):
                raise SkillBlocked("Custom fixture imports must resolve to a file within the configured project")
            fixture = (target.parent / module).resolve()
            if root not in fixture.parents:
                raise ValueError("Fixture import escapes configured project")
            if not any(path.is_file() and root in path.resolve().parents for path in (fixture, Path(str(fixture) + ".ts"), Path(str(fixture) + ".js"), fixture / "index.ts")):
                raise SkillBlocked("Custom fixture module does not exist")
        lines = [f"import {{ test, expect }} from {quote(module)};", "", f"test({quote(value.title)}, async ({{ page }}) => {{"]
        for step in value.steps:
            locator = f"page.locator({quote(step.selector)})"
            if step.operation == "goto":
                statement = f"await page.goto({quote(step.path)});"
            elif step.operation in ("click", "check"):
                statement = f"await {locator}.{step.operation}();"
            elif step.operation == "fill":
                statement = f"await {locator}.fill({quote(step.value)});"
            elif step.operation == "assert_text":
                statement = f"await expect({locator}).toHaveText({quote(step.value)}, {{ useInnerText: true }});"
            elif step.operation == "assert_count":
                statement = f"await expect({locator}).toHaveCount({step.count});"
            else:
                statement = f"await expect({locator}).toBeVisible();"
            lines.append("  " + statement)
        lines.append("});")
    else:
        if value.test_import:
            raise ValueError("Cypress uses its project support file; test_import is a Playwright option")
        lines = [f"describe({quote(value.title)}, () => {{", "  it('satisfies the specified assertions', () => {"]
        for step in value.steps:
            locator = f"cy.get({quote(step.selector)})"
            if step.operation == "goto":
                statement = f"cy.visit({quote(step.path)});"
            elif step.operation in ("click", "check"):
                statement = f"{locator}.{step.operation}();"
            elif step.operation == "fill":
                statement = f"{locator}.clear()" + (f".type({quote(step.value)}, {{ parseSpecialCharSequences: false }})" if step.value else "") + ";"
            elif step.operation == "assert_text":
                statement = f"{locator}.should('have.text', {quote(step.value)});"
            elif step.operation == "assert_count":
                statement = f"{locator}.should('have.length', {step.count});"
            else:
                statement = f"{locator}.should('be.visible');"
            lines.append("    " + statement)
        lines += ["  });", "});"]
    source = "\n".join(lines) + "\n"
    patch = "--- /dev/null\n+++ b/" + value.test_file + "\n@@ -0,0 +1," + str(len(lines)) + " @@\n" + "\n".join("+" + line for line in lines) + "\n"
    return {"framework": framework, "path": value.test_file, "source": source, "patch": patch,
            "sha256": hashlib.sha256(source.encode()).hexdigest(), "review_status": "draft", "executed": False,
            "repository_modified": False, "framework_profile": profile,
            "prerequisites": ["Set the framework baseURL", "Provide required fixtures and test data", "Review and run in the project's test environment"]}
