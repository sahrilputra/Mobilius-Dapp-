import "./App.css";
import { useState, useEffect } from "react";
import {
  AccountId,
  PrivateKey,
  Client,
  TopicMessageSubmitTransaction,
  AccountAllowanceApproveTransaction,
  TokenAssociateTransaction,
} from "@hashgraph/sdk";
import { Buffer } from "buffer";
import { Routes, Route, NavLink } from "react-router-dom";
import CreateCar from "./pages/CreateCar";
import GiveScore from "./pages/GiveScore";
import Borrow from "./pages/BorrowCar";
import Return from "./pages/ReturnCar";
import { ethers } from "ethers";
import { MirrorNodeClient } from "../src/mirrorNodeClient";

// Part 1 - import ABI
import MerchantBackend from './MerchantBackend.json'

function App() {
  const [defaultAccount, setDefaultAccount] = useState("");
  const [score, setScore] = useState(0);
  const [contract, setContract] = useState();

  // Part 2 - define environment variables

  const scAddress = process.env.REACT_APP_SC_ADDRESS;
  const nftAddress = process.env.REACT_APP_NFT_ADDRESS;
  const nftId = AccountId.fromSolidityAddress(nftAddress).toString();
  const ftAddress = process.env.REACT_APP_FT_ADDRESS;
  const ftId = AccountId.fromSolidityAddress(ftAddress).toString();
  const topicId = process.env.REACT_APP_TOPIC_ID;

  const merchantKey = PrivateKey.fromString(process.env.REACT_APP_MERCHANT_PRIVATE_KEY);
  const merchantId = AccountId.fromString(process.env.REACT_APP_MERCHANT_ID);
  const merchantAddress = process.env.REACT_APP_MERCHANT_ADDRESS;

  const customerKey = PrivateKey.fromString(process.env.REACT_APP_CUSTOMER_KEY);
  const customerAccount = AccountId.fromString(process.env.REACT_APP_CUSTOMER_ACCOUNT_ID);

  // Part 3 - create client instance
  const client = Client.forTestnet().setOperator(merchantId, merchantKey);
  const connect = async () => {
    if (window.ethereum) {
      // Part 4 - connect wallet
      const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      signer.getAddress().then(setDefaultAccount);
      window.ethereum.on("accountsChanged", changeConnectedAccount);

      const contractInstance = new ethers.Contract(scAddress, MerchantBackend.abi, signer);
      setContract(contractInstance);
    }
  };

  const changeConnectedAccount = async (newAddress) => {
    try {
      newAddress = Array.isArray(newAddress) ? newAddress[0] : newAddress;
      setDefaultAccount(newAddress);
    } catch (err) {
      console.error(err);
    }
  };

  const getContract = async () => {
    // Part 5 - create contract instance
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    const signer = provider.getSigner();
    signer.getAddress().then(setDefaultAccount);
    const contractInstance = new ethers.Contract(scAddress, MerchantBackend.abi, signer);
    setContract(contractInstance);
  };

  const getScore = async () => {
    try {
      if (defaultAccount) {
        // Part 17 - get reputation token score
        await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${defaultAccount}/tokens?token.id=${ftId}`)
          .then((response) => response.json())
          .then((data) => {
            if (!data.tokens[0]) {
              setScore(0);
              return;
            }
            setScore(data.tokens[0].balance);
          });
      }
    } catch (e) {
      console.log(e);
    }
  };

  useEffect(() => {
    connect();
    getScore();
  }, [defaultAccount]);

  const createCar = async (cid) => {
    try {
      if (!contract) getContract();
      // Part 6 - add new car
      const tx = await contract.mintNFT(nftAddress, [Buffer.from(cid)], {
        gasLimit: 1_000_000,
      });
      await tx.wait();

      // Part 7 - submit add new car logs to topic
      new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(
          `{
   type: Minting,
   accountAddr: ${defaultAccount},
   tokenId: ${nftId}
  }`
        )
        .execute(client);
      alert("Successfully added new car!");
    } catch (e) {
      alert("Failed to add new car");
      console.log(e);
    }
  };

  const associateNFTToken = async (id) => {
    // Part 8 - associate NFT
    const associateTransaction = new TokenAssociateTransaction().setAccountId(customerAccount).setTokenIds([id]).freezeWith(client);
    const signedAssociateTransaction = await associateTransaction.sign(customerKey);
    const transactionResponse = await signedAssociateTransaction.execute(client);
    const associateRx = await transactionResponse.getReceipt(client);
    console.log(`associated with NFT status: ${associateRx.status}`);
  };

  const associateFTToken = async () => {
    // Part 9 - associate fungible token
    const associateTransaction = new TokenAssociateTransaction().setAccountId(customerAccount).setTokenIds([ftId]).freezeWith(client);
    const signedAssociateTransaction = await associateTransaction.sign(customerKey);
    const transactionResponse = await signedAssociateTransaction.execute(client);
    const associateRx = await transactionResponse.getReceipt(client);
    console.log(`associated with Fungible Token status: ${associateRx.status}`);
  };

  const isAssociated = async (id) => {
    // Part 10 - check token association
    const mirrorNodeClient = new MirrorNodeClient("testnet");
    return await mirrorNodeClient
      .getAccountInfo(customerAccount)
      .then((acc) => {
        const associatedTokensList = acc.balance.tokens;
        return associatedTokensList.some((token) => token.token_id === id);
      })
      .catch((rejectErr) => {
        console.log("Could not get token balance", rejectErr);
      });
  };

  const borrowCar = async (id, serial) => {
    // Part 11 - check if tokens are associated, associate them if not
    if (!(await isAssociated(id))) {
      await associateNFTToken(id);
      await associateFTToken();
    }

    try {
      if (!contract) getContract();
      // Part 12 - borrow new car
      const tx = await contract.borrowing(AccountId.fromString(id).toSolidityAddress(), serial, {
        value: ethers.utils.parseEther("1000"),
        gasLimit: 2_000_000,
      });
      await tx.wait();
      // Part 13 - submit borrow car logs to topic
      new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(
          `{
            type: Borrowing,
            accountAddr: ${defaultAccount},
            tokenId: ${id},
            serial: ${serial}
          }`
        )
        .execute(client);
      alert("Successfully borrowed car!");
    } catch (e) {
      alert("Failed to borrrow car");
      console.log(e);
    }
  };

  const getContractId = async () => {
    const mirrorNodeClient = new MirrorNodeClient("testnet");
    return await mirrorNodeClient
      .getContractInfo(scAddress)
      .then((acc) => {
        const contractId = acc.contract_id;
        return contractId;
      })
      .catch((rejectErr) => {
        console.log("Could not get token balance", rejectErr);
      });
  };

  const returnCar = async (id, serial) => {
    try {
      if (!contract) getContract();

      // Part 14 - give SC allowance
      client.setOperator(customerAccount, customerKey);
      const smartContractAccountId = await getContractId();
      const allowanceApproveTxResponse = await new AccountAllowanceApproveTransaction()
        .approveTokenNftAllowanceAllSerials(id, customerAccount, smartContractAccountId)
        .freezeWith(client)
        .execute(client);
      client.setOperator(merchantId, merchantKey);
      console.log(`allowance approve tx response: ${allowanceApproveTxResponse}`);

      // Part 15 - return car
      const tx = await contract.returning(AccountId.fromString(id).toSolidityAddress(), serial, {
        gasLimit: 1_000_000,
      });
      await tx.wait();
      // Part 16 - submit return car logs to topic
      new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(
          `{
    type: Returning,
    accountAddr: ${defaultAccount},
    tokenId: ${id},
    serial: ${serial}
  }`
        )
        .execute(client);
      alert("Successfully returned car!");
    } catch (e) {
      alert("Failed to return car");
      console.log(e);
    }
  };

  const giveScore = async (customer, score) => {
    try {
      if (!contract) getContract();
      // Part 18 - give reputation tokens
      await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${customer}`)
        .then((response) => response.json())
        .then(async (data) => {
          console.log(data.evm_address);
          const tx = await contract.scoring(data.evm_address, score, {
            gasLimit: 1_000_000,
          });
          await tx.wait();
        });

      // Part 19 - submit give REP tokens logs to topic
      new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(
          `{
            type: Scoring,
            accountAddr: ${customer},
            tokenId: ${ftId.toString()},
            amount: ${1}
          }`
        )
        .execute(client);

      alert("Successfully gave REP tokens!");
    } catch (e) {
      alert("Failed to give REP tokens");
      console.log(e);
    }
  };

  const isMerchant = defaultAccount.toLowerCase() === merchantAddress.toLowerCase();
  return (
    <>
      <nav>
        <ul className="nav">
          {isMerchant ? (
            <>
              <NavLink to="/" className="nav-item">
                Add Car
              </NavLink>
              <NavLink to="/give" className="nav-item">
                Give Score
              </NavLink>
            </>
          ) : defaultAccount ? (
            <>
              <NavLink to="/" className="nav-item">
                Borrow Car
              </NavLink>
              <NavLink to="/give" className="nav-item">
                Return Car
              </NavLink>
            </>
          ) : (
            <></>
          )}
          <div className="acc-container">
            {!isMerchant && defaultAccount && <p className="acc-score">My Reputation Tokens: {defaultAccount ? score : "0"}</p>}
            <div className="connect-btn">
              <button onClick={connect} className="primary-btn">
                {defaultAccount
                  ? `${defaultAccount?.slice(0, 5)}...${defaultAccount?.slice(defaultAccount?.length - 4, defaultAccount?.length)}`
                  : "Not Connected"}
              </button>
            </div>
          </div>
        </ul>
      </nav>

      {!defaultAccount ? <h1 className="center">Connect Your Wallet First</h1> : <></>}

      <Routes>
        {isMerchant ? (
          <>
            <Route path="/" element={<CreateCar createCar={createCar} />} />
            <Route path="/give" element={<GiveScore giveScore={giveScore} />} />
          </>
        ) : defaultAccount ? (
          <>
            <Route path="/" element={<Borrow borrowCar={borrowCar} />} />
            <Route path="/give" element={<Return returnCar={returnCar} address={defaultAccount} />} />
          </>
        ) : (
          <></>
        )}
      </Routes>
    </>
  );
}

export default App;
