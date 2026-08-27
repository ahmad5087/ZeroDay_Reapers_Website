-- 099_mentor_starter_faqs.sql — Starter FAQ content for the self-serve mentor (Phase 12). Run after 098.
-- Idempotent (guarded by title). The self-serve mentor searches the resource library's full-text index
-- (073), so a curated FAQ = published `resources` rows. These are starter guides the founder can edit or
-- delete in Admin → Resources. Escalation target when the mentor can't answer: BOOK OFFICE HOURS (baked
-- into the "I'm stuck" entry below). Domain-agnostic (domain_id null) so every department sees them.

insert into public.resources (title, description, kind, is_published, published_at)
select v.title, v.description, 'guide', true, now()
from (values
  ('FAQ: How do I submit my weekly task?',
   'Open the Tasks tab in the portal, pick the current week''s task, and upload your submission (PDF or DOC). A mentor reviews every submission and marks it Approved or Rejected with written feedback. You can see your marks and feedback back in the Tasks tab.'),
  ('FAQ: What if I miss a deadline or need more time?',
   'Apply for an extension from the Tasks section in the portal. An admin can grant extra time until a specific date. If your submission was rejected, you resubmit by requesting an extension, then uploading a new version.'),
  ('FAQ: How is my work graded?',
   'Each submission is reviewed by a mentor and marked Approved or Rejected, with feedback. Approved tasks count toward your certificate. Rejected tasks must be corrected and resubmitted (request an extension to reopen the upload).'),
  ('FAQ: How do I earn the internship certificate?',
   'Complete all six weekly tasks on schedule and get each one approved. You then receive a verifiable ZeroDay Reapers internship completion certificate, which anyone can validate on our public certificate verification page.'),
  ('FAQ: What are the RAM / system requirements?',
   'Some tasks are assigned by RAM tier (8, 16, or 24 GB), so set your RAM correctly in your profile to get the right tasks. A Linux virtual machine or lab environment is strongly recommended for the practical work.'),
  ('FAQ: Is there a registration fee?',
   'Cohort 2 has a one-time registration fee of PKR 1,000, paid after Week 1. There are no other charges — the internship itself is remote and task-based.'),
  ('FAQ: What are office hours and how do I join?',
   'Office hours are scheduled live mentor sessions. Find upcoming sessions in the portal and join using the link shown. If you are blocked on a task, booking or attending office hours is the fastest way to get unstuck.'),
  ('FAQ: How do I join the Discord and WhatsApp community?',
   'Use the Discord and WhatsApp links on the ZeroDay Reapers website to join the community for announcements, resources, and support. Department groups are for applicants accepted into that field.'),
  ('FAQ: Can I refer friends, and what do I get?',
   'Yes. Share your personal referral link from the portal. The more interns you refer who actually join the internship, the better your chance to become a community admin — and to work with the founder directly in future.'),
  ('FAQ: Which domains can I intern in?',
   'ZeroDay Reapers offers internships in Offensive Security, Defensive Security, Cloud Security, AI Security, GRC (Governance, Risk & Compliance), and Digital Forensics.'),
  ('FAQ: I''m stuck on a task — what should I do?',
   'First, search these FAQs and the Resource Library for your topic. If you are still blocked, message an admin in the portal or book office hours — that is the right place to escalate a question the self-serve mentor cannot answer.')
) as v(title, description)
where not exists (select 1 from public.resources r where r.title = v.title);
