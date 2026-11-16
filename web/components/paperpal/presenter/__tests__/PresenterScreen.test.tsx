// @vitest-environment jsdom
// Drives the presenter through the keyboard, the nav buttons, the overview and
// the Q&A pads, to check the screen still wires them to the slide index and
// the saved notes.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Slide } from "@/lib/paperpal/presenter";
import PresenterScreen from "../PresenterScreen";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  back.mockReset();
  window.localStorage.clear();
});

const slides: Slide[] = [
  { kind: "title", title: "Deck title", sub: "A, B", lead: "Paper companion", targetSeconds: 30 },
  { kind: "claim", eyebrow: "The bet", title: "Claim title", body: "Claim body.", targetSeconds: 90 },
  {
    kind: "discussion",
    eyebrow: "Open questions",
    items: ["First question?", "Second question?"],
    targetSeconds: 240,
  },
  { kind: "end", title: "Thank you.", body: "Bye.", targetSeconds: 20 },
];

const key = (k: string) => fireEvent.keyDown(document, { key: k });
const counter = () => screen.getByText(/\/\s*04$/).textContent?.replace(/\s+/g, " ");

it("shows an empty state without slides", () => {
  render(<PresenterScreen paperId="7" slides={[]} />);
  expect(screen.getByText("No slides for this paper yet.")).toBeInTheDocument();
});

it("moves with the arrow keys, space and the nav buttons, and stops at the ends", () => {
  render(<PresenterScreen paperId="7" slides={slides} />);
  expect(screen.getByRole("heading", { name: "Deck title" })).toBeInTheDocument();
  expect(counter()).toBe("01 / 04");

  key("ArrowLeft");
  expect(counter()).toBe("01 / 04");

  key("ArrowRight");
  expect(screen.getByRole("heading", { name: "Claim title" })).toBeInTheDocument();
  key(" ");
  key("ArrowRight");
  key("ArrowRight");
  expect(counter()).toBe("04 / 04");
  expect(screen.getByRole("heading", { name: "Thank you." })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
  expect(counter()).toBe("03 / 04");
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(counter()).toBe("04 / 04");
});

it("keeps the slide across a remount", () => {
  const first = render(<PresenterScreen paperId="7" slides={slides} />);
  key("ArrowRight");
  first.unmount();
  render(<PresenterScreen paperId="7" slides={slides} />);
  expect(counter()).toBe("02 / 04");
});

it("saves Q&A notes per question, and typing in a pad does not change slides", () => {
  render(<PresenterScreen paperId="7" slides={slides} />);
  key("ArrowRight");
  key("ArrowRight");
  const pads = screen.getAllByPlaceholderText("Capture what came up…");
  expect(pads).toHaveLength(2);

  fireEvent.change(pads[1], { target: { value: "Someone asked about baselines" } });
  fireEvent.keyDown(pads[1], { key: "ArrowRight" });
  fireEvent.keyDown(pads[1], { key: "o" });
  expect(counter()).toBe("03 / 04");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Saved")).toBeInTheDocument();

  cleanup();
  render(<PresenterScreen paperId="7" slides={slides} />);
  const again = screen.getAllByPlaceholderText("Capture what came up…");
  expect(again[0]).toHaveValue("");
  expect(again[1]).toHaveValue("Someone asked about baselines");
});

it("opens the overview with O or G, jumps to a slide, and Esc closes it before exiting", () => {
  render(<PresenterScreen paperId="7" slides={slides} />);
  key("o");
  const dialog = screen.getByRole("dialog", { name: "Slide overview" });
  expect(dialog).toHaveTextContent("4 slides · click to jump");
  expect(dialog).toHaveTextContent("First question?");

  fireEvent.click(screen.getByText("Claim title").closest("button") as HTMLButtonElement);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(counter()).toBe("02 / 04");

  key("g");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  key("Escape");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(back).not.toHaveBeenCalled();

  key("Escape");
  expect(back).toHaveBeenCalledTimes(1);
});

it("calls onExit instead of going back when one is given", () => {
  const onExit = vi.fn();
  render(<PresenterScreen paperId="7" slides={slides} onExit={onExit} />);
  fireEvent.click(screen.getByRole("button", { name: "Exit" }));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
});

it("times the talk and the slide, warns near the target, and resets with T", () => {
  const { container } = render(<PresenterScreen paperId="7" slides={slides} />);
  const total = () => container.querySelector(".timer.total")?.textContent;
  const slide = () => container.querySelector(".timer.slide") as HTMLElement;

  act(() => { vi.advanceTimersByTime(26_000); });
  expect(total()).toBe("00:26");
  expect(slide()).toHaveClass("is-near"); // 26 s of a 30 s target
  act(() => { vi.advanceTimersByTime(4_000); });
  expect(slide()).toHaveClass("is-over");

  key("ArrowRight");
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(total()).toBe("00:31");
  expect(slide()).toHaveTextContent("00:01");
  expect(slide()).toHaveTextContent("/ 01:30");
  expect(slide()).not.toHaveClass("is-near");

  key("t");
  act(() => { vi.advanceTimersByTime(250); });
  expect(total()).toBe("00:00");
});

it("pauses the clock", () => {
  const { container } = render(<PresenterScreen paperId="7" slides={slides} />);
  act(() => { vi.advanceTimersByTime(2_000); });
  fireEvent.click(screen.getByRole("button", { name: "pause" }));
  act(() => { vi.advanceTimersByTime(5_000); });
  expect(container.querySelector(".timer.total")).toHaveTextContent("00:02");
  expect(screen.getByRole("button", { name: "play" })).toBeInTheDocument();
});

it("clamps a saved slide past the end of a shorter deck", () => {
  const first = render(<PresenterScreen paperId="7" slides={slides} />);
  key("ArrowRight");
  key("ArrowRight");
  key("ArrowRight");
  first.unmount();

  // The companion was regenerated with fewer slides since the last session.
  render(<PresenterScreen paperId="7" slides={slides.slice(0, 2)} />);
  expect(screen.getByText(/\/\s*02$/).textContent?.replace(/\s+/g, " ")).toBe("02 / 02");
  expect(screen.getByRole("heading", { name: "Claim title" })).toBeInTheDocument();
  key("ArrowLeft");
  expect(screen.getByRole("heading", { name: "Deck title" })).toBeInTheDocument();
});
