import { fetchHint, type FetchHintInput } from "./hint";
import { fetchSocratic, type FetchSocraticInput } from "./socratic";
import { withPaperPalSession } from "./request";

export function requestAssessmentHint(input: FetchHintInput, signal?: AbortSignal) {
  return withPaperPalSession((token, requestSignal, timeoutMs) =>
    fetchHint(input, { accessToken: token, signal: requestSignal, timeoutMs }), signal);
}

export function requestAssessmentTutor(input: FetchSocraticInput, signal?: AbortSignal) {
  return withPaperPalSession((token, requestSignal, timeoutMs) =>
    fetchSocratic(input, { accessToken: token, signal: requestSignal, timeoutMs }), signal);
}
