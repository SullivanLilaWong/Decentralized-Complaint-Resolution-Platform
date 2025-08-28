import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Complaint {
  owner: string;
  description: string;
  category: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resolved: boolean;
  escalationLevel: number;
  attachments: Uint8Array[];
  involvedParties: string[];
}

interface HistoryEntry {
  timestamp: number;
  action: string;
  actor: string;
}

interface CategoryStats {
  count: number;
  resolved: number;
  averageResolutionTime: number;
}

interface EscalatedComplaint {
  arbiter: string | null;
  resolutionProposal: string | null;
}

interface ContractState {
  complaints: Map<number, Complaint>;
  complaintHistory: Map<number, HistoryEntry[]>;
  categoryStats: Map<string, CategoryStats>;
  userComplaints: Map<string, number[]>;
  escalatedComplaints: Map<number, EscalatedComplaint>;
  nextComplaintId: number;
  totalComplaints: number;
  escalationFee: number;
  contractOwner: string;
  blockHeight: number;
}

// Mock contract implementation
class ComplaintTrackerMock {
  private state: ContractState = {
    complaints: new Map(),
    complaintHistory: new Map(),
    categoryStats: new Map(),
    userComplaints: new Map(),
    escalatedComplaints: new Map(),
    nextComplaintId: 1,
    totalComplaints: 0,
    escalationFee: 100,
    contractOwner: "deployer",
    blockHeight: 1000,
  };

  private ERR_NOT_OWNER = 100;
  private ERR_INVALID_STATUS = 101;
  private ERR_COMPLAINT_NOT_FOUND = 102;
  private ERR_UNAUTHORIZED = 103;
  private ERR_ALREADY_RESOLVED = 104;
  private ERR_INVALID_CATEGORY = 105;
  private ERR_MAX_ATTACHMENTS = 106;
  private ERR_MAX_PARTIES = 107;
  private ERR_ESCALATION_LIMIT = 109;

  private incrementBlockHeight() {
    this.state.blockHeight += 1;
  }

  submitComplaint(caller: string, description: string, category: string, attachments: Uint8Array[], involvedParties: string[]): ClarityResponse<number> {
    if (description.length === 0) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (category === "") {
      return { ok: false, value: this.ERR_INVALID_CATEGORY };
    }
    if (attachments.length > 5) {
      return { ok: false, value: this.ERR_MAX_ATTACHMENTS };
    }
    if (involvedParties.length > 10) {
      return { ok: false, value: this.ERR_MAX_PARTIES };
    }

    const id = this.state.nextComplaintId;
    this.state.complaints.set(id, {
      owner: caller,
      description,
      category,
      status: "open",
      createdAt: this.state.blockHeight,
      updatedAt: this.state.blockHeight,
      resolved: false,
      escalationLevel: 0,
      attachments,
      involvedParties,
    });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "submitted", actor: caller });
    this.state.complaintHistory.set(id, history);

    const userCompls = this.state.userComplaints.get(caller) ?? [];
    userCompls.push(id);
    this.state.userComplaints.set(caller, userCompls);

    this.state.nextComplaintId += 1;
    this.state.totalComplaints += 1;

    const stats = this.state.categoryStats.get(category) ?? { count: 0, resolved: 0, averageResolutionTime: 0 };
    stats.count += 1;
    this.state.categoryStats.set(category, stats);

    this.incrementBlockHeight();
    return { ok: true, value: id };
  }

  updateComplaint(caller: string, id: number, newDescription?: string, newStatus?: string, addAttachments?: Uint8Array[], addParties?: string[]): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (caller !== complaint.owner) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (complaint.resolved) {
      return { ok: false, value: this.ERR_ALREADY_RESOLVED };
    }

    const updatedDesc = newDescription ?? complaint.description;
    const updatedStatus = newStatus ?? complaint.status;
    const updatedAttachments = [...complaint.attachments, ...(addAttachments ?? [])].slice(0, 5);
    const updatedParties = [...complaint.involvedParties, ...(addParties ?? [])].slice(0, 10);

    if (!["open", "in-progress", "resolved", "escalated", "closed"].includes(updatedStatus)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }

    this.state.complaints.set(id, { ...complaint, description: updatedDesc, status: updatedStatus, updatedAt: this.state.blockHeight, attachments: updatedAttachments, involvedParties: updatedParties });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: `updated to ${updatedStatus}`, actor: caller });
    this.state.complaintHistory.set(id, history.slice(-20));

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  escalateComplaint(caller: string, id: number): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (caller !== complaint.owner) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (complaint.resolved) {
      return { ok: false, value: this.ERR_ALREADY_RESOLVED };
    }
    if (complaint.escalationLevel >= 3) {
      return { ok: false, value: this.ERR_ESCALATION_LIMIT };
    }

    // Simulate fee transfer success

    this.state.complaints.set(id, { ...complaint, status: "escalated", escalationLevel: complaint.escalationLevel + 1, updatedAt: this.state.blockHeight });
    this.state.escalatedComplaints.set(id, { arbiter: null, resolutionProposal: null });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "escalated", actor: caller });
    this.state.complaintHistory.set(id, history);

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  proposeEscalationResolution(caller: string, id: number, proposal: string): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    const esc = this.state.escalatedComplaints.get(id);
    if (!esc) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (!complaint.involvedParties.includes(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }

    this.state.escalatedComplaints.set(id, { ...esc, resolutionProposal: proposal });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "resolution proposed", actor: caller });
    this.state.complaintHistory.set(id, history);

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  acceptEscalationResolution(caller: string, id: number): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (caller !== complaint.owner) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const esc = this.state.escalatedComplaints.get(id);
    if (!esc || !esc.resolutionProposal) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }

    this.state.complaints.set(id, { ...complaint, status: "resolved", resolved: true, updatedAt: this.state.blockHeight });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "resolution accepted", actor: caller });
    this.state.complaintHistory.set(id, history);

    const resolutionTime = this.state.blockHeight - complaint.createdAt;
    const stats = this.state.categoryStats.get(complaint.category) ?? { count: 0, resolved: 0, averageResolutionTime: 0 };
    const newResolved = stats.resolved + 1;
    const newAvg = ((stats.averageResolutionTime * stats.resolved) + resolutionTime) / newResolved;
    this.state.categoryStats.set(complaint.category, { ...stats, resolved: newResolved, averageResolutionTime: newAvg });

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  assignArbiter(caller: string, id: number, arbiter: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    const esc = this.state.escalatedComplaints.get(id);
    if (!esc) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }

    this.state.escalatedComplaints.set(id, { ...esc, arbiter });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "arbiter assigned", actor: caller });
    this.state.complaintHistory.set(id, history);

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  closeComplaint(caller: string, id: number): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (caller !== complaint.owner) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (complaint.resolved) {
      return { ok: false, value: this.ERR_ALREADY_RESOLVED };
    }

    this.state.complaints.set(id, { ...complaint, status: "closed", updatedAt: this.state.blockHeight });

    const history = this.state.complaintHistory.get(id) ?? [];
    history.push({ timestamp: this.state.blockHeight, action: "closed", actor: caller });
    this.state.complaintHistory.set(id, history);

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  getComplaintDetails(id: number): ClarityResponse<Complaint | null> {
    return { ok: true, value: this.state.complaints.get(id) ?? null };
  }

  getComplaintHistory(id: number): ClarityResponse<HistoryEntry[] | null> {
    return { ok: true, value: this.state.complaintHistory.get(id) ?? null };
  }

  getUserComplaints(user: string): ClarityResponse<number[] | null> {
    return { ok: true, value: this.state.userComplaints.get(user) ?? null };
  }

  getCategoryStats(category: string): ClarityResponse<CategoryStats | null> {
    return { ok: true, value: this.state.categoryStats.get(category) ?? null };
  }

  getTotalComplaints(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalComplaints };
  }

  getEscalatedComplaint(id: number): ClarityResponse<EscalatedComplaint | null> {
    return { ok: true, value: this.state.escalatedComplaints.get(id) ?? null };
  }

  isInvolved(id: number, party: string): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    return { ok: true, value: complaint.involvedParties.includes(party) };
  }

  setEscalationFee(caller: string, newFee: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.escalationFee = newFee;
    return { ok: true, value: true };
  }

  transferOwnership(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
  user3: "wallet_3",
};

describe("ComplaintTracker Contract", () => {
  let contract: ComplaintTrackerMock;

  beforeEach(() => {
    contract = new ComplaintTrackerMock();
  });

  it("should allow registered user to submit a complaint", () => {
    const result = contract.submitComplaint(
      accounts.user1,
      "Faulty product",
      "electronics",
      [new Uint8Array(32)],
      [accounts.user2]
    );
    expect(result).toEqual({ ok: true, value: 1 });

    const details = contract.getComplaintDetails(1);
    expect(details.ok).toBe(true);
    expect(details.value).toMatchObject({
      owner: accounts.user1,
      description: "Faulty product",
      category: "electronics",
      status: "open",
      resolved: false,
      escalationLevel: 0,
    });
  });

  it("should prevent submission with invalid data", () => {
    const emptyDesc = contract.submitComplaint(accounts.user1, "", "electronics", [], []);
    expect(emptyDesc).toEqual({ ok: false, value: 101 });

    const emptyCat = contract.submitComplaint(accounts.user1, "Desc", "", [], []);
    expect(emptyCat).toEqual({ ok: false, value: 105 });
  });

  it("should allow owner to update complaint", () => {
    contract.submitComplaint(accounts.user1, "Initial desc", "cat", [], []);

    const updateResult = contract.updateComplaint(
      accounts.user1,
      1,
      "New desc",
      "in-progress",
      [new Uint8Array(32)]
    );
    expect(updateResult).toEqual({ ok: true, value: true });

    const details = contract.getComplaintDetails(1);
    expect((details.value as Complaint).description).toBe("New desc");
    expect((details.value as Complaint).status).toBe("in-progress");
  });

  it("should prevent non-owner from updating", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], []);

    const updateResult = contract.updateComplaint(accounts.user2, 1, "New", undefined);
    expect(updateResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow escalation by owner", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], []);

    const escalateResult = contract.escalateComplaint(accounts.user1, 1);
    expect(escalateResult).toEqual({ ok: true, value: true });

    const details = contract.getComplaintDetails(1);
    expect((details.value as Complaint).status).toBe("escalated");
    expect((details.value as Complaint).escalationLevel).toBe(1);
  });

  it("should prevent escalation beyond limit", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], []);
    contract.escalateComplaint(accounts.user1, 1);
    contract.escalateComplaint(accounts.user1, 1);
    contract.escalateComplaint(accounts.user1, 1);

    const escalateAgain = contract.escalateComplaint(accounts.user1, 1);
    expect(escalateAgain).toEqual({ ok: false, value: 109 });
  });

  it("should allow involved party to propose resolution", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], [accounts.user2]);
    contract.escalateComplaint(accounts.user1, 1);

    const proposeResult = contract.proposeEscalationResolution(accounts.user2, 1, "Fix it");
    expect(proposeResult).toEqual({ ok: true, value: true });

    const esc = contract.getEscalatedComplaint(1);
    expect((esc.value as EscalatedComplaint).resolutionProposal).toBe("Fix it");
  });

  it("should allow owner to accept resolution", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], [accounts.user2]);
    contract.escalateComplaint(accounts.user1, 1);
    contract.proposeEscalationResolution(accounts.user2, 1, "Fix it");

    const acceptResult = contract.acceptEscalationResolution(accounts.user1, 1);
    expect(acceptResult).toEqual({ ok: true, value: true });

    const details = contract.getComplaintDetails(1);
    expect((details.value as Complaint).status).toBe("resolved");
    expect((details.value as Complaint).resolved).toBe(true);
  });

  it("should allow admin to assign arbiter", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], []);
    contract.escalateComplaint(accounts.user1, 1);

    const assignResult = contract.assignArbiter(accounts.deployer, 1, accounts.user3);
    expect(assignResult).toEqual({ ok: true, value: true });

    const esc = contract.getEscalatedComplaint(1);
    expect((esc.value as EscalatedComplaint).arbiter).toBe(accounts.user3);
  });

  it("should allow owner to close complaint", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], []);

    const closeResult = contract.closeComplaint(accounts.user1, 1);
    expect(closeResult).toEqual({ ok: true, value: true });

    const details = contract.getComplaintDetails(1);
    expect((details.value as Complaint).status).toBe("closed");
  });

  it("should update category stats on resolution", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], [accounts.user2]);
    contract.escalateComplaint(accounts.user1, 1);
    contract.proposeEscalationResolution(accounts.user2, 1, "Fix");
    contract.acceptEscalationResolution(accounts.user1, 1);

    const stats = contract.getCategoryStats("cat");
    expect(stats.value).toMatchObject({ count: 1, resolved: 1 });
  });

  it("should return user complaints", () => {
    contract.submitComplaint(accounts.user1, "Desc1", "cat", [], []);
    contract.submitComplaint(accounts.user1, "Desc2", "cat", [], []);

    const userCompls = contract.getUserComplaints(accounts.user1);
    expect(userCompls.value).toEqual([1, 2]);
  });

  it("should check if party is involved", () => {
    contract.submitComplaint(accounts.user1, "Desc", "cat", [], [accounts.user2]);

    const isInvolved = contract.isInvolved(1, accounts.user2);
    expect(isInvolved).toEqual({ ok: true, value: true });
  });

  it("should allow admin to set escalation fee", () => {
    const setFee = contract.setEscalationFee(accounts.deployer, 200);
    expect(setFee).toEqual({ ok: true, value: true });
  });

  it("should allow admin to transfer ownership", () => {
    const transfer = contract.transferOwnership(accounts.deployer, accounts.user1);
    expect(transfer).toEqual({ ok: true, value: true });
  });
});