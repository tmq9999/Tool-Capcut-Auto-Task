export interface CapcutTask {
  taskKey: string;
  taskId: number;
  title: string;
  reward: number;
  /** 1 = open, 2 = intermediate, 4 = completed. */
  status: number;
  buttonText: string;
  childIds: number[];
}

export interface TaskSnapshot {
  at: number;
  byKey: Map<string, CapcutTask>;
  totalReward: number;
  earnedReward: number;
  doneKeys: string[];
}

export interface ActionProof {
  actionKey: string;
  opId: string;
  errNo: number;
  errTips: string;
  at: number;
}
