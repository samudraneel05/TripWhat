import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TripWalkthrough } from "../src/components/landing/TripWalkthrough";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripWalkthrough", () => {
  it("starts with a clearly labeled sample and only one visible step", () => {
    const onStart = vi.fn();
    render(<TripWalkthrough onStart={onStart} />);

    expect(screen.getByText("Interactive preview")).toBeVisible();
    expect(screen.getByText("Sample trip · Paris")).toBeVisible();
    expect(screen.getByText("Just a demo. Nothing is saved or booked.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Describe your trip/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Start with what you love." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Plan my trip" })).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("moves forwards and backwards and supports direct step selection", async () => {
    const user = userEvent.setup();
    render(<TripWalkthrough onStart={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByRole("tab", { name: /Find your places/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Sample places" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Start with what you love." })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByRole("tab", { name: /See your days/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Day 1 sample stops" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Previous step" }));
    expect(screen.getByRole("tab", { name: /Find your places/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));
    expect(screen.getByRole("button", { name: "Plan my trip" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next step" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: /Describe your trip/ }));
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
  });

  it("supports roving tab focus, arrow wrapping, Home, and End", async () => {
    const user = userEvent.setup();
    render(<TripWalkthrough onStart={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");

    await user.tab();
    expect(tabs[0]).toHaveFocus();
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);

    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[1].id);
    expect(tabs[1]).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);

    await user.keyboard("{End}");
    expect(tabs[3]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tabs[3]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
  });

  it("removes and re-adds the museum in both the itinerary and illustrative map", async () => {
    const user = userEvent.setup();
    render(<TripWalkthrough onStart={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));

    const itinerary = screen.getByRole("list", { name: "Day 1 sample stops" });
    expect(within(itinerary).getAllByRole("listitem")).toHaveLength(3);
    expect(within(itinerary).getByText("Musée d’Orsay")).toBeVisible();
    expect(screen.getByRole("img", { name: /Illustrative Paris map with 3 sample stops:.*Musée d’Orsay/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Remove Musée d’Orsay" }));
    expect(within(itinerary).getAllByRole("listitem")).toHaveLength(2);
    expect(within(itinerary).queryByText("Musée d’Orsay")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Illustrative Paris map with 2 sample stops/ })).not.toHaveAccessibleName(/Musée d’Orsay/);
    expect(screen.getByRole("status")).toHaveTextContent("Museum removed. 2 sample stops.");
    expect(screen.getByText("More time to wander.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add Musée d’Orsay back" }));
    expect(within(itinerary).getAllByRole("listitem")).toHaveLength(3);
    expect(within(itinerary).getByText("Musée d’Orsay")).toBeVisible();
    expect(screen.getByRole("img", { name: /Illustrative Paris map with 3 sample stops:.*Musée d’Orsay/ })).toBeVisible();
    expect(screen.queryByText("More time to wander.")).not.toBeInTheDocument();
  });

  it("preserves edits between steps and resets all demo state with Start over", async () => {
    const user = userEvent.setup();
    render(<TripWalkthrough onStart={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));
    await user.click(screen.getByRole("button", { name: "Remove Musée d’Orsay" }));
    await user.click(screen.getByRole("button", { name: "Previous step" }));

    expect(within(screen.getByRole("list", { name: "Day 1 sample stops" })).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByRole("button", { name: "Add Musée d’Orsay back" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(screen.getByRole("tab", { name: /Describe your trip/ })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /Describe your trip/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 4: Describe your trip. 3 sample stops.");
    expect(screen.getByRole("img", { name: /Illustrative Paris map with 3 sample stops/ })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));
    expect(screen.getByRole("button", { name: "Remove Musée d’Orsay" })).toBeVisible();
    expect(within(screen.getByRole("list", { name: "Day 1 sample stops" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("never starts a real trip or fetches data while exploring the preview", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<TripWalkthrough onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Remove Musée d’Orsay" }));
    await user.click(screen.getByRole("button", { name: "Add Musée d’Orsay back" }));
    await user.click(screen.getByRole("button", { name: "Previous step" }));
    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));
    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(onStart).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hands the exact sample prompt to onStart only when Plan my trip is clicked", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<TripWalkthrough onStart={onStart} />);
    await user.click(screen.getByRole("tab", { name: /Make it yours/ }));
    await user.click(screen.getByRole("button", { name: "Remove Musée d’Orsay" }));
    expect(onStart).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Plan my trip" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith("Plan a relaxed 3-day trip to Paris with cafés, art, and time to wander.");
  });
});
