import type { ReviewAssignmentBoardVO, ReviewType } from "@bv/shared";
import { http } from "./http";

export async function fetchReviewAssignments(): Promise<ReviewAssignmentBoardVO> {
  const { data } = await http.get<ReviewAssignmentBoardVO>("/review-assignments");
  return data;
}

export async function saveReviewAssignment(
  reviewType: ReviewType,
  assigneeUserIds: string[],
): Promise<ReviewAssignmentBoardVO> {
  const { data } = await http.put<ReviewAssignmentBoardVO>(`/review-assignments/${reviewType}`, {
    assignee_user_ids: assigneeUserIds,
  });
  return data;
}
