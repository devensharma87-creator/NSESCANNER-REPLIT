/**
 * runtimeIdentity — non-secret process identity constants.
 *
 * Generated ONCE at module load. Stable for the entire process lifetime.
 * Used by the owner-only DB diagnostics surface to allow observers to detect
 * cross-autoscale-instance comparisons. Backend-PID comparisons are only valid
 * within the same runtimeBootId + runtimeProcessId.
 *
 * No secrets, credentials, DATABASE_URL or connection strings are stored here.
 */
import { randomUUID } from "crypto";

/** Unix process identifier. Changes on every OS-level restart. */
export const RUNTIME_PROCESS_ID: number = process.pid;

/**
 * UUID generated once at module load. Distinct for every Node.js process even
 * if the PID is recycled by the OS. Two /system/mode/diagnostics responses with
 * different runtimeBootIds came from different processes; their backendPid values
 * must not be compared.
 */
export const RUNTIME_BOOT_ID: string = randomUUID();

/** ISO-8601 wall-clock time at module evaluation (= process boot time). */
export const RUNTIME_STARTED_AT: string = new Date().toISOString();
