"use client";

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ContributionDay = {
  date: string;
  contributionCount: number;
  color: string;
};

type ContributionWeek = {
  contributionDays: ContributionDay[];
};

interface CommitHeatmapProps {
  weeks: ContributionWeek[];
}

export const CommitHeatmap = ({ weeks }: CommitHeatmapProps) => {
  if (!weeks.length) return null;

  // Year label (from first visible contribution)
  const firstDate = new Date(weeks[0].contributionDays[0].date);
  const yearLabel = firstDate.getFullYear();

  // Month labels
  const monthLabels = weeks.map((week) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return null;

    const date = new Date(firstDay.date);
    return date.toLocaleString("default", { month: "short" });
  });

  return (
    <div className="flex gap-3 overflow-x-auto">
      {/* Year label */}
      <div className="flex flex-col justify-center">
        <span className="text-xs text-muted-foreground -rotate-90 origin-center">
          {yearLabel}
        </span>
      </div>

      <div>
        {/* Month labels */}
        <div className="flex gap-1 mb-2 pl-[2px]">
          {monthLabels.map((month, index) => {
            const prevMonth = monthLabels[index - 1];
            return (
              <div
                key={index}
                className="w-3 text-[10px] text-muted-foreground"
              >
                {month !== prevMonth ? month : ""}
              </div>
            );
          })}
        </div>

        {/* Heatmap grid */}
        <div className="flex gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.contributionDays.map((day) => (
                <Tooltip key={day.date}>
                  <TooltipTrigger>
                    <div
                      className="h-3 w-3 rounded-sm cursor-pointer transition-opacity hover:opacity-80"
                      style={{ backgroundColor: day.color }}
                    />
                  </TooltipTrigger>

                  <TooltipContent>
                    <p className="text-xs">
                      {day.contributionCount} contributions on{" "}
                      {new Date(day.date).toDateString()}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-1">
            {["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"].map(
              (color) => (
                <div
                  key={color}
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: color }}
                />
              )
            )}
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
