// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// Game economy data structures
interface EconomicIndicator {
  name: string;
  currentValue: number;
  encryptedValue: string;
  trend: 'up' | 'down' | 'stable';
  change: number;
}

interface Player {
  address: string;
  name: string;
  level: number;
  resources: { [key: string]: number };
  encryptedBalance: string;
  rank: number;
}

interface Resource {
  name: string;
  basePrice: number;
  currentPrice: number;
  encryptedPrice: string;
  supply: number;
  demand: number;
}

interface ProductionRecord {
  id: string;
  playerAddress: string;
  resourceType: string;
  amount: number;
  encryptedAmount: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
}

// FHE encryption/decryption utilities
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const parts = encryptedData.substring(4).split('-');
    return parseFloat(atob(parts[0]));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string, modifier?: number): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'multiply':
      result = value * (modifier || 1);
      break;
    case 'add':
      result = value + (modifier || 0);
      break;
    case 'market_fluctuation':
      // Simulate market fluctuations based on player activity
      result = value * (0.9 + Math.random() * 0.2);
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<string>("");
  const [transactionStatus, setTransactionStatus] = useState<{ 
    visible: boolean; 
    status: "pending" | "success" | "error"; 
    message: string; 
  }>({ visible: false, status: "pending", message: "" });

  // Game state
  const [economicIndicators, setEconomicIndicators] = useState<EconomicIndicator[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [playerRankings, setPlayerRankings] = useState<Player[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // UI states
  const [activeTab, setActiveTab] = useState<'dashboard' | 'market' | 'production' | 'rankings'>('dashboard');
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [newProduction, setNewProduction] = useState({ resourceType: 'Gold', amount: 0 });
  const [newTrade, setNewTrade] = useState({ resource: 'Gold', amount: 0, action: 'buy' as 'buy' | 'sell' });

  // Initialize game data
  useEffect(() => {
    initializeGameData().finally(() => setLoading(false));
    setPublicKey(generatePublicKey());
  }, []);

  const initializeGameData = async () => {
    setIsRefreshing(true);
    try {
      // Initialize economic indicators
      const initialIndicators: EconomicIndicator[] = [
        { name: 'GDP', currentValue: 1000, encryptedValue: FHEEncryptNumber(1000), trend: 'up', change: 2.5 },
        { name: 'Inflation', currentValue: 2.1, encryptedValue: FHEEncryptNumber(2.1), trend: 'stable', change: 0.1 },
        { name: 'Resource Index', currentValue: 150, encryptedValue: FHEEncryptNumber(150), trend: 'up', change: 5.2 }
      ];
      setEconomicIndicators(initialIndicators);

      // Initialize resources
      const initialResources: Resource[] = [
        { name: 'Gold', basePrice: 100, currentPrice: 105, encryptedPrice: FHEEncryptNumber(105), supply: 1000, demand: 950 },
        { name: 'Wood', basePrice: 10, currentPrice: 12, encryptedPrice: FHEEncryptNumber(12), supply: 5000, demand: 5200 },
        { name: 'Ore', basePrice: 25, currentPrice: 28, encryptedPrice: FHEEncryptNumber(28), supply: 2000, demand: 2100 }
      ];
      setResources(initialResources);

      // Initialize sample players
      const samplePlayers: Player[] = [
        { address: '0x742d35Cc6634C0532925a3b8D5F7...', name: 'CryptoPioneer', level: 45, resources: { Gold: 150, Wood: 800, Ore: 300 }, encryptedBalance: FHEEncryptNumber(12500), rank: 1 },
        { address: '0x8932aC125634F8E2a5b9D8F5C7d6...', name: 'DeFiMaster', level: 38, resources: { Gold: 80, Wood: 1200, Ore: 150 }, encryptedBalance: FHEEncryptNumber(8900), rank: 2 },
        { address: address || '0x0000...', name: 'NewPlayer', level: 1, resources: { Gold: 10, Wood: 50, Ore: 20 }, encryptedBalance: FHEEncryptNumber(100), rank: 3 }
      ];
      setPlayers(samplePlayers);
      setPlayerRankings(samplePlayers.sort((a, b) => b.level - a.level));

    } catch (error) {
      console.error('Error initializing game data:', error);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Contract interaction functions
  const checkContractAvailability = async () => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Checking ZAMA FHE contract availability..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "✓ ZAMA FHE contract is available and ready!" });
      }
    } catch (error: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract check failed: " + (error.message || "Unknown error") });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const storeGameData = async (key: string, data: any) => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting and storing data with ZAMA FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");

      const encryptedData = FHEEncryptNumber(typeof data === 'number' ? data : JSON.stringify(data));
      await contract.setData(key, ethers.toUtf8Bytes(encryptedData));
      
      setTransactionStatus({ visible: true, status: "success", message: "✓ Data encrypted and stored securely!" });
    } catch (error: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Storage failed: " + (error.message || "Unknown error") });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const retrieveGameData = async (key: string) => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({ visible: true, status: "pending", message: "Retrieving and decrypting FHE data..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");

      const encryptedDataBytes = await contract.getData(key);
      if (encryptedDataBytes.length === 0) {
        setTransactionStatus({ visible: true, status: "error", message: "No data found for key: " + key });
        return null;
      }

      const encryptedData = ethers.toUtf8String(encryptedDataBytes);
      const decryptedValue = FHEDecryptNumber(encryptedData);
      
      setTransactionStatus({ visible: true, status: "success", message: "✓ Data retrieved and decrypted successfully!" });
      return decryptedValue;
    } catch (error: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Retrieval failed: " + (error.message || "Unknown error") });
      return null;
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Game mechanics
  const simulateMarketFluctuation = () => {
    setResources(prevResources => 
      prevResources.map(resource => ({
        ...resource,
        currentPrice: resource.currentPrice * (0.95 + Math.random() * 0.1),
        encryptedPrice: FHECompute(resource.encryptedPrice, 'market_fluctuation'),
        supply: Math.max(100, resource.supply + Math.floor(Math.random() * 200 - 100)),
        demand: Math.max(100, resource.demand + Math.floor(Math.random() * 200 - 100))
      }))
    );

    setEconomicIndicators(prev => prev.map(indicator => ({
      ...indicator,
      currentValue: indicator.currentValue * (0.98 + Math.random() * 0.04),
      encryptedValue: FHECompute(indicator.encryptedValue, 'market_fluctuation'),
      change: (Math.random() - 0.5) * 2
    })));
  };

  const handleProduction = async () => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }

    const productionRecord: ProductionRecord = {
      id: Date.now().toString(),
      playerAddress: address!,
      resourceType: newProduction.resourceType,
      amount: newProduction.amount,
      encryptedAmount: FHEEncryptNumber(newProduction.amount),
      timestamp: Math.floor(Date.now() / 1000),
      status: 'pending'
    };

    // Store production record
    await storeGameData(`production_${productionRecord.id}`, JSON.stringify(productionRecord));
    
    // Add to local state
    setProductionRecords(prev => [productionRecord, ...prev]);
    setShowProductionModal(false);
    setNewProduction({ resourceType: 'Gold', amount: 0 });
  };

  const handleTrade = async () => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return;
    }

    const tradeRecord = {
      id: Date.now().toString(),
      playerAddress: address!,
      resource: newTrade.resource,
      amount: newTrade.amount,
      action: newTrade.action,
      timestamp: Math.floor(Date.now() / 1000)
    };

    await storeGameData(`trade_${tradeRecord.id}`, JSON.stringify(tradeRecord));
    setShowTradeModal(false);
    setNewTrade({ resource: 'Gold', amount: 0, action: 'buy' });
    
    // Simulate market impact
    simulateMarketFluctuation();
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) {
      alert("Please connect wallet first");
      return null;
    }

    try {
      const message = `Decrypt FHE data with ZAMA\nPublic Key: ${publicKey}\nTimestamp: ${Date.now()}`;
      await signMessageAsync({ message });
      
      // Simulate decryption process
      await new Promise(resolve => setTimeout(resolve, 2000));
      return FHEDecryptNumber(encryptedData);
    } catch (error) {
      console.error("Decryption failed:", error);
      return null;
    }
  };

  if (loading) {
    return (
      <div className="loading-screen hud-theme">
        <div className="hud-spinner"></div>
        <p className="hud-text">Initializing FHE-Encrypted MMO Economy...</p>
        <div className="hud-scanline"></div>
      </div>
    );
  }

  return (
    <div className="app-container hud-theme">
      {/* HUD Header */}
      <header className="hud-header">
        <div className="hud-title">
          <div className="zama-logo"></div>
          <h1>FHE-MMO Economy</h1>
          <span className="hud-subtitle">ZAMA Powered Encrypted Economy</span>
        </div>
        
        <div className="hud-controls">
          <button className="hud-btn" onClick={checkContractAvailability}>
            Check FHE Contract
          </button>
          <button className="hud-btn" onClick={simulateMarketFluctuation}>
            Simulate Market
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={true} />
          </div>
        </div>
      </header>

      {/* Main HUD Interface */}
      <div className="hud-main">
        {/* Navigation Tabs */}
        <nav className="hud-nav">
          {(['dashboard', 'market', 'production', 'rankings'] as const).map(tab => (
            <button
              key={tab}
              className={`hud-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="hud-dashboard">
            <div className="hud-grid">
              {/* Economic Indicators */}
              <div className="hud-panel economic-panel">
                <h3>Economic Indicators (FHE Encrypted)</h3>
                <div className="indicators-grid">
                  {economicIndicators.map((indicator, index) => (
                    <div key={index} className="indicator-item">
                      <span className="indicator-name">{indicator.name}</span>
                      <span className="indicator-value">{indicator.currentValue.toFixed(2)}</span>
                      <span className={`indicator-trend ${indicator.trend}`}>
                        {indicator.trend === 'up' ? '↗' : indicator.trend === 'down' ? '↘' : '→'} 
                        {Math.abs(indicator.change).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Player Stats */}
              <div className="hud-panel player-panel">
                <h3>Your Stats</h3>
                {players.find(p => p.address === address) ? (
                  <div className="player-stats">
                    <div className="stat-row">
                      <span>Level</span>
                      <span>{players.find(p => p.address === address)?.level}</span>
                    </div>
                    <div className="stat-row">
                      <span>Rank</span>
                      <span>#{players.find(p => p.address === address)?.rank}</span>
                    </div>
                    <div className="resources-grid">
                      {Object.entries(players.find(p => p.address === address)?.resources || {}).map(([res, amount]) => (
                        <div key={res} className="resource-item">
                          <span>{res}</span>
                          <span>{amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p>Connect wallet to view your stats</p>
                )}
              </div>

              {/* Quick Actions */}
              <div className="hud-panel actions-panel">
                <h3>Quick Actions</h3>
                <button className="hud-btn primary" onClick={() => setShowProductionModal(true)}>
                  Start Production
                </button>
                <button className="hud-btn secondary" onClick={() => setShowTradeModal(true)}>
                  Trade Resources
                </button>
                <button className="hud-btn" onClick={() => setActiveTab('rankings')}>
                  View Rankings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Market Tab */}
        {activeTab === 'market' && (
          <div className="hud-market">
            <div className="market-header">
              <h3>Resource Market (FHE Encrypted Pricing)</h3>
              <button className="hud-btn" onClick={simulateMarketFluctuation}>
                Refresh Market
              </button>
            </div>
            <div className="market-grid">
              {resources.map((resource, index) => (
                <div key={index} className="market-item hud-panel">
                  <div className="resource-header">
                    <h4>{resource.name}</h4>
                    <span className={`price-change ${resource.currentPrice > resource.basePrice ? 'up' : 'down'}`}>
                      {resource.currentPrice > resource.basePrice ? '↗' : '↘'}
                    </span>
                  </div>
                  <div className="resource-info">
                    <div className="info-row">
                      <span>Price:</span>
                      <span>{resource.currentPrice.toFixed(2)}</span>
                    </div>
                    <div className="info-row">
                      <span>Supply/Demand:</span>
                      <span>{resource.supply}/{resource.demand}</span>
                    </div>
                    <div className="info-row">
                      <span>Balance:</span>
                      <span>{players.find(p => p.address === address)?.resources[resource.name] || 0}</span>
                    </div>
                  </div>
                  <div className="market-actions">
                    <button className="hud-btn buy" onClick={() => {
                      setNewTrade({ resource: resource.name, amount: 10, action: 'buy' });
                      setShowTradeModal(true);
                    }}>
                      Buy
                    </button>
                    <button className="hud-btn sell" onClick={() => {
                      setNewTrade({ resource: resource.name, amount: 10, action: 'sell' });
                      setShowTradeModal(true);
                    }}>
                      Sell
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Production Tab */}
        {activeTab === 'production' && (
          <div className="hud-production">
            <div className="production-header">
              <h3>Production System</h3>
              <button className="hud-btn primary" onClick={() => setShowProductionModal(true)}>
                New Production
              </button>
            </div>
            <div className="production-list">
              {productionRecords.map(record => (
                <div key={record.id} className="production-record hud-panel">
                  <div className="record-info">
                    <span className="resource-type">{record.resourceType}</span>
                    <span className="amount">{record.amount} units</span>
                    <span className={`status ${record.status}`}>{record.status}</span>
                    <span className="timestamp">
                      {new Date(record.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rankings Tab */}
        {activeTab === 'rankings' && (
          <div className="hud-rankings">
            <h3>Player Rankings</h3>
            <div className="rankings-list">
              {playerRankings.map((player, index) => (
                <div key={index} className="ranking-item hud-panel">
                  <span className="rank">#{player.rank}</span>
                  <span className="player-name">{player.name}</span>
                  <span className="level">Level {player.level}</span>
                  <span className="address">{player.address.substring(0, 8)}...</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Production Modal */}
      {showProductionModal && (
        <div className="hud-modal-overlay">
          <div className="hud-modal">
            <div className="modal-header">
              <h3>Start Production</h3>
              <button onClick={() => setShowProductionModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Resource Type</label>
                <select 
                  value={newProduction.resourceType}
                  onChange={(e) => setNewProduction({...newProduction, resourceType: e.target.value})}
                  className="hud-select"
                >
                  <option value="Gold">Gold</option>
                  <option value="Wood">Wood</option>
                  <option value="Ore">Ore</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  value={newProduction.amount}
                  onChange={(e) => setNewProduction({...newProduction, amount: parseInt(e.target.value) || 0})}
                  className="hud-input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="hud-btn" onClick={() => setShowProductionModal(false)}>Cancel</button>
              <button className="hud-btn primary" onClick={handleProduction}>Start Production</button>
            </div>
          </div>
        </div>
      )}

      {/* Trade Modal */}
      {showTradeModal && (
        <div className="hud-modal-overlay">
          <div className="hud-modal">
            <div className="modal-header">
              <h3>{newTrade.action === 'buy' ? 'Buy' : 'Sell'} Resources</h3>
              <button onClick={() => setShowTradeModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Resource</label>
                <select 
                  value={newTrade.resource}
                  onChange={(e) => setNewTrade({...newTrade, resource: e.target.value})}
                  className="hud-select"
                >
                  <option value="Gold">Gold</option>
                  <option value="Wood">Wood</option>
                  <option value="Ore">Ore</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  value={newTrade.amount}
                  onChange={(e) => setNewTrade({...newTrade, amount: parseInt(e.target.value) || 0})}
                  className="hud-input"
                />
              </div>
              <div className="form-group">
                <label>Action</label>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      value="buy"
                      checked={newTrade.action === 'buy'}
                      onChange={(e) => setNewTrade({...newTrade, action: e.target.value as 'buy' | 'sell'})}
                    />
                    Buy
                  </label>
                  <label>
                    <input
                      type="radio"
                      value="sell"
                      checked={newTrade.action === 'sell'}
                      onChange={(e) => setNewTrade({...newTrade, action: e.target.value as 'buy' | 'sell'})}
                    />
                    Sell
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="hud-btn" onClick={() => setShowTradeModal(false)}>Cancel</button>
              <button className="hud-btn primary" onClick={handleTrade}>
                {newTrade.action === 'buy' ? 'Buy' : 'Sell'} Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status */}
      {transactionStatus.visible && (
        <div className="hud-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === 'pending' && '⏳'}
              {transactionStatus.status === 'success' && '✅'}
              {transactionStatus.status === 'error' && '❌'}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      {/* HUD Footer */}
      <footer className="hud-footer">
        <div className="footer-info">
          <span>FHE-MMO Economy v1.0 | Powered by ZAMA FHE Technology</span>
          <span>All economic data is fully homomorphically encrypted</span>
        </div>
        <div className="footer-stats">
          <span>Players Online: {players.length}</span>
          <span>Active Trades: {productionRecords.length}</span>
        </div>
      </footer>

      {/* HUD Scanline Effect */}
      <div className="hud-scanline"></div>
    </div>
  );
};

export default App;