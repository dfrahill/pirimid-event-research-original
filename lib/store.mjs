import { createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = `${dir}/jobs.json`;
    mkdirSync(dir, { recursive: true });
    this.jobs = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : [];
    for (const j of this.jobs)
      if (j.status === "running") {
        j.status = "interrupted";
        j.error =
          "The local service restarted before this run completed. Start a new run.";
      }
    this.shortlistFile = `${dir}/shortlist.json`;
    this.shortlist = existsSync(this.shortlistFile)
      ? JSON.parse(readFileSync(this.shortlistFile, "utf8"))
      : [];
    this.save();
  }
  save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.jobs, null, 2), {
      mode: 0o600,
    });
    renameSync(`${this.file}.tmp`, this.file);
  }
  saveProspect(record) {
    const id = createHash("sha256")
      .update(
        [record.name, record.company || record.location, record.sourceUrl].join(
          "|",
        ),
      )
      .digest("hex");
    const existing = this.shortlist.find((r) => r.id === id);
    const item = {
      ...record,
      id,
      savedAt: existing?.savedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.shortlist = this.shortlist.filter((r) => r.id !== id);
    this.shortlist.unshift(item);
    this.saveShortlist();
    return item;
  }
  removeProspect(id) {
    this.shortlist = this.shortlist.filter((r) => r.id !== id);
    this.saveShortlist();
  }
  saveShortlist() {
    writeFileSync(
      `${this.shortlistFile}.tmp`,
      JSON.stringify(this.shortlist, null, 2),
      { mode: 0o600 },
    );
    renameSync(`${this.shortlistFile}.tmp`, this.shortlistFile);
  }
  add(job) {
    this.jobs.unshift(job);
    this.save();
    return job;
  }
  update(id, change) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    Object.assign(j, change);
    this.save();
    return j;
  }
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function csv(records) {
  if (!records.length) return "";
  const fields = Object.keys(records[0]);
  return [fields, ...records.map((r) => fields.map((f) => r[f]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
