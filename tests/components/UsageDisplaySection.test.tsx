import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UsageDisplaySection } from "@/components/usage/UsageDisplaySection";

const pickCurrency = async (
  user: ReturnType<typeof userEvent.setup>,
  code: string,
) => {
  await user.click(
    screen.getByRole("combobox", { name: "usage.display.currency" }),
  );
  await user.click(
    await screen.findByRole("option", { name: new RegExp(`^${code}`) }),
  );
};

describe("UsageDisplaySection", () => {
  // jsdom 没有 scrollIntoView，下拉打开时会调
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("offers every display currency and hides the rate while showing USD", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UsageDisplaySection value={undefined} onChange={onChange} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("combobox", { name: "usage.display.currency" }),
    );
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent?.slice(0, 3))).toEqual([
      "USD",
      "CNY",
      "EUR",
      "JPY",
      "TWD",
      "TRY",
    ]);
    await user.keyboard("{Escape}");

    await pickCurrency(user, "JPY");
    expect(onChange).toHaveBeenCalledWith({ currency: "JPY" });
    // 预置汇率：用户没填过时从这里起步
    expect(screen.getByRole("textbox")).toHaveValue("158");
  });

  it("rejects a bad rate and keeps the rates of other currencies", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UsageDisplaySection
        value={{ currency: "CNY", exchangeRates: { CNY: 7, EUR: 0.9 } }}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("7");

    await user.clear(input);
    await user.type(input, "0{Enter}");
    expect(screen.getByText("usage.display.rateInvalid")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "7.25{Enter}");
    expect(onChange).toHaveBeenCalledWith({
      currency: "CNY",
      exchangeRates: { CNY: 7.25, EUR: 0.9 },
    });
  });

  it("switches the rate box to the rate saved for the picked currency", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UsageDisplaySection
        value={{ currency: "CNY", exchangeRates: { CNY: 7, EUR: 0.9 } }}
        onChange={onChange}
      />,
    );
    await pickCurrency(user, "EUR");
    expect(screen.getByRole("textbox")).toHaveValue("0.9");
  });

  it("does not write the preset rate when it was left unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UsageDisplaySection value={{ currency: "TWD" }} onChange={onChange} />,
    );
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows and hides request log columns", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <UsageDisplaySection
        value={{ currency: "CNY", requestLogColumns: { app: false } }}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "usage.display.logColumns: usage.display.logColumnsSummary",
      }),
    );
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "usage.time" }),
    ).not.toBeInTheDocument();
    const status = await screen.findByRole("menuitemcheckbox", {
      name: "usage.statusCode",
    });
    expect(status).toHaveAttribute("aria-checked", "false");
    await user.click(status);

    // 菜单不关，可以接着勾；保存时其它显示设置原样带上，只存改过的列
    expect(onChange).toHaveBeenLastCalledWith({
      currency: "CNY",
      requestLogColumns: { app: false, statusCode: true },
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "usage.statusCode" }),
    ).toHaveAttribute("aria-checked", "true");

    // 勾回默认值的列不再写进设置
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "usage.app" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      currency: "CNY",
      requestLogColumns: { statusCode: true },
    });

    await user.click(
      screen.getByRole("menuitem", { name: "usage.logColumns.reset" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      currency: "CNY",
      requestLogColumns: {},
    });
  });

  it("picks the trend chart style and keeps the other display settings", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UsageDisplaySection value={{ currency: "CNY" }} onChange={onChange} />,
    );
    const trigger = screen.getByRole("combobox", {
      name: "usage.display.trendChartType",
    });
    // 没设置过按柱形图
    expect(trigger).toHaveTextContent("usage.display.trendChartTypes.bar");

    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", {
        name: "usage.display.trendChartTypes.area",
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      currency: "CNY",
      trendChartType: "area",
    });
    expect(trigger).toHaveTextContent("usage.display.trendChartTypes.area");
  });
});
