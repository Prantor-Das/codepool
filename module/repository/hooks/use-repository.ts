"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchRepositories } from "../action";

export const useRepository = () => {
  return useInfiniteQuery({
    queryKey: ["repositories"],
    queryFn: ({ pageParam }) => {
      return fetchRepositories(pageParam, 10);
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 10) return undefined;
      return allPages.length + 1;
    },
    initialPageParam: 1,
  });
};
