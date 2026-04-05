import { hostname } from "node:os";
import { WORKER_POLL_INTERVAL_MS } from "../../server/src/config.js";
import { claimNextJob, completeJob, failJob, getHackathon, getSubmission, listHackathons, recordEvent } from "../../server/src/store.js";
import { evaluateSubmission } from "./analysis.js";

async function handleJob(job: { id: string; type: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.type !== "evaluate_submission") {
    await recordEvent({
      scope: "job",
      source: "worker",
      type: "job.ignored",
      actor: hostname(),
      hackathonId: null,
      submissionId: null,
      awardId: null,
      claimId: null,
      txHash: null,
      payload: { jobId: job.id, type: job.type },
    });
    return;
  }

  const submissionId = String(job.payload.submissionId ?? "");
  const submission = await getSubmission(submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found`);
  const hackathon = await getHackathon(submission.hackathonId);
  if (!hackathon) throw new Error(`Hackathon ${submission.hackathonId} not found`);
  const track = hackathon.tracks.find((entry) => entry.id === submission.trackId);
  if (!track) throw new Error(`Track ${submission.trackId} not found`);

  await evaluateSubmission({
    hackathon,
    track,
    submission,
  });
}

async function loop(): Promise<void> {
  const workerId = `judgebuddy-worker:${hostname()}`;
  for (;;) {
    const job = await claimNextJob(workerId);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_INTERVAL_MS));
      continue;
    }

    try {
      await handleJob(job);
      await completeJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message);
      await recordEvent({
        scope: "job",
        source: "worker",
        type: "job.failed",
        actor: workerId,
        hackathonId: null,
        submissionId: null,
        awardId: null,
        claimId: null,
        txHash: null,
        payload: { jobId: job.id, error: message },
      });
    }
  }
}

async function main() {
  await listHackathons();
  console.log("JudgeBuddy worker running");
  await loop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
