import type { KycScenarioVO, SaveKycScenarioInput } from "@bv/shared";
import { http } from "./http";

/** 材料上传页引用：已发布模板 */
export async function fetchActiveScenarios(): Promise<KycScenarioVO[]> {
  const { data } = await http.get<KycScenarioVO[]>("/kyc/scenarios/active");
  return data;
}

/** 配置页：全部模板（含草稿） */
export async function fetchAllScenarios(): Promise<KycScenarioVO[]> {
  const { data } = await http.get<KycScenarioVO[]>("/kyc/scenarios");
  return data;
}

export async function createScenario(input: SaveKycScenarioInput): Promise<KycScenarioVO> {
  const { data } = await http.post<KycScenarioVO>("/kyc/scenarios", input);
  return data;
}

export async function updateScenario(
  id: string,
  input: SaveKycScenarioInput,
): Promise<KycScenarioVO> {
  const { data } = await http.patch<KycScenarioVO>(`/kyc/scenarios/${id}`, input);
  return data;
}

export async function publishScenario(id: string): Promise<KycScenarioVO> {
  const { data } = await http.post<KycScenarioVO>(`/kyc/scenarios/${id}/publish`);
  return data;
}

export async function deleteScenario(id: string): Promise<void> {
  await http.delete(`/kyc/scenarios/${id}`);
}
