import type { ChangeImpactResult, ChangeReviewReport } from "./types.js";

type ChangeReviewDraft = Omit<ChangeReviewReport, "markdown">;

const securityPathPattern =
  /(^|\/)(\.github|security|auth|oauth|session|token|secret|credential|permission|policy|install|release|deploy|infra|scripts?|Dockerfile|k8s|kubernetes)(\/|\.|$)/i;

export function buildChangeReviewReport(impact: ChangeImpactResult, generatedAt = new Date().toISOString()): ChangeReviewReport {
  const securityNotes = securityReviewNotes(impact);
  const checklist = reviewChecklist(impact, securityNotes);
  const draft: ChangeReviewDraft = {
    generatedAt,
    root: impact.root,
    risk: impact.risk,
    summary: impact.summary,
    changedFiles: impact.changedFileDetails,
    impacted: impact.impacted,
    signals: impact.signals,
    securityNotes,
    checklist
  };
  return { ...draft, markdown: renderChangeReviewMarkdown(draft) };
}

export function renderChangeReviewMarkdown(report: ChangeReviewDraft): string {
  const changedRows =
    report.changedFiles.length > 0
      ? report.changedFiles
          .slice(0, 25)
          .map(
            (file) =>
              `| ${file.risk} | ${escapeTable(file.status)} | \`${escapeBackticks(file.path)}\` | ${file.symbols} | ${file.directEdges} | ${escapeTable(file.reasons.join("; ") || "none")} |`
          )
          .join("\n")
      : "| none | none | none | 0 | 0 | no uncommitted changes detected |";

  const impactedRows =
    report.impacted.length > 0
      ? report.impacted
          .slice(0, 15)
          .map((item) => `| ${item.score.toFixed(2)} | \`${escapeBackticks(item.item)}\` | ${escapeTable(item.reason)} |`)
          .join("\n")
      : "| 0.00 | none | no impacted indexed symbols found |";

  return `# RepoLens Change Review

Generated: ${report.generatedAt}
Root: ${report.root}
Risk: ${report.risk}

## Summary

- Changed files: ${report.summary.changedFileCount}
- Indexed changed files: ${report.summary.indexedChangedFileCount}
- Impacted indexed items: ${report.summary.impactedItemCount}
- Direct graph relationships: ${report.summary.directEdgeCount}
- Top edge types: ${inlineCounts(report.summary.topEdgeTypes, "type")}
- Top symbol kinds: ${inlineCounts(report.summary.topSymbolKinds, "kind")}

## Changed Files

| Risk | Status | File | Symbols | Direct edges | Notes |
| --- | --- | --- | ---: | ---: | --- |
${changedRows}

## Top Impacted Items

| Score | Item | Reason |
| ---: | --- | --- |
${impactedRows}

## Security Review Notes

${markdownList(report.securityNotes)}

## Suggested PR Checklist

${markdownChecklist(report.checklist)}

## Signals

${markdownList(report.signals.length ? report.signals : ["change impact completed without extra signals"])}
`;
}

function securityReviewNotes(impact: ChangeImpactResult): string[] {
  const notes: string[] = [];
  const securityFiles = impact.changedFileDetails.filter((file) => securityPathPattern.test(file.path));
  const unindexedFiles = impact.changedFileDetails.filter((file) => !file.indexed);
  const highRiskFiles = impact.changedFileDetails.filter((file) => file.risk === "high");
  const mediumRiskFiles = impact.changedFileDetails.filter((file) => file.risk === "medium");

  if (impact.changedFileDetails.length === 0) {
    notes.push("No uncommitted changes were detected; generate the report after edits or against the branch checkout to review PR impact.");
  }
  if (securityFiles.length > 0) {
    notes.push(`Review security-sensitive paths: ${securityFiles.slice(0, 8).map((file) => file.path).join(", ")}.`);
  }
  if (highRiskFiles.length > 0) {
    notes.push(`High-risk graph impact found in ${highRiskFiles.length} changed file(s); inspect inbound callers and release/security boundaries before merge.`);
  } else if (mediumRiskFiles.length > 0) {
    notes.push(`Medium-risk graph impact found in ${mediumRiskFiles.length} changed file(s); verify callers, tests, and generated artifacts.`);
  }
  if (unindexedFiles.length > 0) {
    notes.push(`${unindexedFiles.length} changed file(s) are not in the current graph; re-index before treating impact coverage as complete.`);
  }
  if (impact.summary.directEdgeCount > 80) {
    notes.push("The changed files touch many graph relationships; include focused regression evidence for the highest-degree files.");
  }
  if (notes.length === 0) {
    notes.push("No security-sensitive path or high-impact graph signal was detected from the indexed change set.");
  }
  return notes;
}

function reviewChecklist(impact: ChangeImpactResult, securityNotes: string[]): string[] {
  const checklist = [
    "Reviewed changed-file risk, direct graph relationships, and top impacted indexed items.",
    "Ran the relevant focused tests for the changed behavior.",
    "Confirmed generated artifacts, local databases, graph packages, and private reports are not part of the commit."
  ];
  if (impact.changedFileDetails.some((file) => !file.indexed)) {
    checklist.unshift("Re-indexed the repository so new or previously skipped files are represented in the graph.");
  }
  if (securityNotes.some((note) => /security-sensitive|High-risk|Medium-risk/i.test(note))) {
    checklist.push("Reviewed security, release, install, auth, credential, and workflow boundaries touched by this change.");
  }
  return checklist;
}

function inlineCounts<T extends Record<string, unknown>>(items: T[], key: keyof T): string {
  if (items.length === 0) {
    return "none";
  }
  return items
    .slice(0, 5)
    .map((item) => `${String(item[key])} (${String(item.count ?? 0)})`)
    .join(", ");
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${escapeMarkdownText(item)}`).join("\n");
}

function markdownChecklist(items: string[]): string {
  return items.map((item) => `- [ ] ${escapeMarkdownText(item)}`).join("\n");
}

function escapeTable(value: string): string {
  return escapeMarkdown(value, new Set(["`", "|"]));
}

function escapeBackticks(value: string): string {
  return escapeMarkdown(value, new Set(["`"]));
}

function escapeMarkdownText(value: string): string {
  return escapeMarkdown(value, new Set(["`"]));
}

function escapeMarkdown(value: string, extraEscapedCharacters: Set<string>): string {
  let escaped = "";
  for (const char of value) {
    if (char === "\n") {
      escaped += " ";
    } else if (char === "\\" || extraEscapedCharacters.has(char)) {
      escaped += `\\${char}`;
    } else {
      escaped += char;
    }
  }
  return escaped;
}
