"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectedRepo } from "../action";

export const useConnectRepo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      owner,
      repo,
      githubId,
    }: {
      owner: string;
      repo: string;
      githubId: number;
    }) => {
      return connectedRepo(owner, repo, githubId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["repositories"],
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["monthly-activity"] });
    },
  });
};
