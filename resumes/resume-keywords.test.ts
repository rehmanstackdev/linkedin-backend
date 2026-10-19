import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractKeywords, buildJobQuery } from "./resume-keywords";
import { ResumesService } from "./resumes.service";

test("extracts canonical skills, aliases, and role without collecting contact details", () => {
  const result = extractKeywords("Sam, sam@example.com. Front-end Developer. ReactJS, NextJS, postgres, TypeScript, AWS. ReactJS.");
  assert.deepEqual(result.keywords, ["TypeScript", "React", "Next.js", "PostgreSQL", "AWS"]);
  assert.equal(result.suggestedRole, "Frontend Developer");
  assert.equal(result.warning, null);
});
test("does not detect skills inside unrelated words", () => {
  const result = extractKeywords("Django development, goals, explicit explanations and GitHub.");
  assert.deepEqual(result.keywords, ["Django"]);
});
test("returns an editable empty result for an unfamiliar profession", () => {
  const result = extractKeywords("Professional musician and orchestral conductor.");
  assert.deepEqual(result.keywords, []);
  assert.ok(result.warning);
});
test("Apify query includes reviewed keywords and removes duplicates", () => {
  assert.equal(buildJobQuery(" Developer ", [" React ", "React", "TypeScript", ""]), "Developer React TypeScript");
});

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

test("PDF upload parses text and persists extracted keywords with the resume", async () => {
  let stored: Record<string, unknown> | undefined;
  let profile: Record<string, unknown> | undefined;
  const service = new ResumesService(
    { save: async (value: Record<string, unknown>) => { stored = value; return value; } } as never,
    { findOne: async () => ({ id: "user-1" }) } as never,
    {} as never,
    { latest: async () => ({ location: "Lahore", jobType: "Full-time" }), save: async (_id: string, value: Record<string, unknown>) => { profile = value; } } as never,
  );
  // Isolate file storage; exercise the actual PDF parser and upload workflow.
  Object.assign(service, { uploadToCloudinary: async () => ({ public_id: "resume-1", secure_url: "https://example.invalid/resume" }) });
  const buffer = pdf("Frontend Developer - React TypeScript PostgreSQL AWS experience");
  await service.upload("user-1", { buffer, mimetype: "application/pdf", originalname: "resume.pdf", size: buffer.length } as Express.Multer.File);
  assert.deepEqual(stored?.keywords, ["TypeScript", "React", "PostgreSQL", "AWS"]);
  assert.equal(stored?.suggestedRole, "Frontend Developer");
  assert.equal(profile?.targetRole, "Frontend Developer");
  assert.deepEqual(profile?.skills, ["TypeScript", "React", "PostgreSQL", "AWS"]);
  assert.equal(profile?.location, "Lahore");
});

test("rejects corrupt documents before uploading them", async () => {
  const service = new ResumesService({} as never, { findOne: async () => ({ id: "user-1" }) } as never, {} as never);
  await assert.rejects(service.upload("user-1", { buffer: Buffer.from("invalid"), mimetype: "application/pdf" } as Express.Multer.File), /Could not read this resume/);
});

test("DOCX upload extracts real document text before storage", async () => {
  let stored: Record<string, unknown> | undefined;
  const service = new ResumesService(
    { save: async (value: Record<string, unknown>) => { stored = value; return value; } } as never,
    { findOne: async () => ({ id: "user-1" }) } as never,
    {} as never,
  );
  Object.assign(service, { uploadToCloudinary: async () => ({ public_id: "resume-2", secure_url: "https://example.invalid/resume" }) });
  const buffer = readFileSync(join(__dirname, "fixtures", "sample-resume.docx"));
  await service.upload("user-1", { buffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", originalname: "resume.docx", size: buffer.length } as Express.Multer.File);
  assert.deepEqual(stored?.keywords, ["Python", "SQL", "Tableau", "Excel"]);
  assert.equal(stored?.suggestedRole, "Data Analyst");
});
