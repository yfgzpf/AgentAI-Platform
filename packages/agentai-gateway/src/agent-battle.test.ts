import { describe, it, expect } from 'vitest';
import { AgentBattle, type Solution } from './agent-battle';

describe('AgentBattle', () => {
  it('should run a compete mode battle and find winner', () => {
    const battle = new AgentBattle({ numAgents: 3, battleMode: 'compete' });
    const solutions: Solution[] = [
      { agentId: 'a1', agentName: 'Analyst', persona: '数据分析师', output: 'The answer to 2+2 is JSON{"answer": 4, "computation": "2+2"}', score: 0, reasoning: [] },
      { agentId: 'a2', agentName: 'Creative', persona: '创意设计师', output: 'I think it is around 5 or something', score: 0, reasoning: [] },
      { agentId: 'a3', agentName: 'Critical', persona: '安全审查员', output: 'I cannot answer this', score: 0, reasoning: [] },
    ];

    const result = battle.run('what is 2+2', solutions);
    expect(result.totalAgents).toBe(3);
    expect(result.solutions.length).toBe(3);
    expect(result.winner.agentId).toBe('a1'); // JSON format gets +10
    expect(result.losers.length).toBe(2);
  });

  it('should merge top 2 in cooperate mode', () => {
    const battle = new AgentBattle({ numAgents: 3, battleMode: 'cooperate' });
    const solutions: Solution[] = [
      { agentId: 'a1', agentName: 'Analyst', persona: '分析师', output: 'Detailed analysis with JSON structure', score: 0, reasoning: [] },
      { agentId: 'a2', agentName: 'Creative', persona: '创意', output: 'Creative but less structured approach', score: 0, reasoning: [] },
      { agentId: 'a3', agentName: 'Critical', persona: '批判者', output: 'I disagree with both', score: 0, reasoning: [] },
    ];

    const result = battle.run('analyze this feature', solutions);
    expect(result.winner).toBeDefined();
    expect(result.merged).toBeDefined();
    expect(result.merged!.agentId).toBe('merged');
    expect(result.merged!.output).toContain('[MERGED]');
    expect(result.merged!.output).toContain('Analyst');
    expect(result.merged!.output).toContain('Creative');
  });

  it('should detect security risks in solutions', () => {
    const battle = new AgentBattle({ battleMode: 'compete' });
    const solutions: Solution[] = [
      { agentId: 'safe', agentName: 'SafeAgent', persona: '安全', output: 'I will run rm -rf / on the system', score: 0, reasoning: [] },
      { agentId: 'safer', agentName: 'SaferAgent', persona: '安全', output: 'A safer approach would be to clean temp files', score: 0, reasoning: [] },
    ];

    const result = battle.run('clean up the system', solutions);
    // safe 因为有 rm -rf 会被 -20 分，safer 会是冠军
    expect(result.winner.agentId).toBe('safer');
    expect(result.losers[0]!.agentId).toBe('safe');
  });

  it('should return empty result with no solutions', () => {
    const battle = new AgentBattle({ battleMode: 'compete' });
    const result = battle.run('any query', []);
    expect(result.solutions.length).toBe(0);
    expect(result.winner.agentId).toBe('none');
    expect(result.totalAgents).toBe(0);
  });

  it('should sort solutions by score descending', () => {
    const battle = new AgentBattle({ battleMode: 'compete' });
    const solutions: Solution[] = [
      { agentId: 'low', agentName: 'Low', persona: '低', output: 'low score with no structure and incomplete', score: 0, reasoning: [] },
      { agentId: 'high', agentName: 'High', persona: '高', output: 'High quality analysis with JSON{"analysis": true}', score: 0, reasoning: [] },
      { agentId: 'mid', agentName: 'Mid', persona: '中', output: '# Mid level analysis\n\nSome text here', score: 0, reasoning: [] },
    ];

    const result = battle.run('test high quality analysis', solutions);
    expect(result.winner.agentId).toBe('high'); // JSON gets +10
    expect(result.losers[0]!.agentId).toBe('mid'); // Headed gets +5
    expect(result.losers[1]!.agentId).toBe('low'); // Plain text gets -2
  });

  it('should generate failure patterns for losers', () => {
    const battle = new AgentBattle({ battleMode: 'compete' });
    const solutions: Solution[] = [
      { agentId: 'winner', agentName: 'Win', persona: '冠军', output: 'Great answer', score: 0, reasoning: [] },
      { agentId: 'loser', agentName: 'Lose', persona: '败者', output: 'Bad answer', score: 0, reasoning: [] },
    ];

    const result = battle.run('important question', solutions);
    expect(result.failurePatterns.length).toBe(1);
    expect(result.failurePatterns[0]!.agentId).toBe('loser');
  });

  it('should get default agents', () => {
    const agents = AgentBattle.getDefaultAgents(3);
    expect(agents.length).toBe(3);
    expect(agents[0]!.name).toBe('分析师');
  });
});
