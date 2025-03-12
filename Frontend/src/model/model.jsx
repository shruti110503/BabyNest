import { Alert } from "react-native";
import { initLlama, releaseAllLlama } from "llama.rn";
import RNFS from "react-native-fs";
import axios from "axios";
import DeviceInfo from "react-native-device-info";
// import {MODEL_NAME, HF_TO_GGUF, GGUF_FILE} from "@env";

const MODEL_NAME = "Qwen2-0.5B-Instruct";
const HF_TO_GGUF = {
  "Qwen2-0.5B-Instruct": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
};
const GGUF_FILE = "qwen2.5-0.5b-instruct-q4_k_m.gguf";

let context = null;

export const fetchAvailableGGUFs = async () => {
  try {
    const repoPath = HF_TO_GGUF[MODEL_NAME];
    if (!repoPath) 
        throw new Error(`No repository mapping found for ${MODEL_NAME}`);

    const response = await axios.get(`https://huggingface.co/api/models/${repoPath}`);
    if (!response.data?.siblings) 
        throw new Error("Invalid API response format");

    return response.data.siblings.filter(file => file.rfilename.endsWith(".gguf")).map(file => file.rfilename);
  } catch (error) {
    Alert.alert("Error", error.message || "Failed to fetch .gguf files");
    return [];
  }
};

export const checkMemoryBeforeLoading = async (modelPath) => {
  const stats = await RNFS.stat(modelPath);
  const fileSizeMB = stats.size / (1024 * 1024);
  const availableMemoryMB = (await DeviceInfo.getFreeDiskStorage()) / (1024 * 1024);

  if (fileSizeMB > availableMemoryMB * 0.8) {
    Alert.alert("Low Memory", "The model may be too large to load!");
    return false;
  }

  if(fileSizeMB < 100){
    Alert.alert("Corrupted Model", "The model may be corrupted. Please download again.");
    return false;
  }
  return true;
};

export const downloadModel = async (fileName, onProgress) => {
  const downloadUrl = `https://huggingface.co/${HF_TO_GGUF[MODEL_NAME]}/resolve/main/${fileName}`;
  const destPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

  if (await RNFS.exists(destPath)) {
    await loadModel(fileName);
    return destPath;
  }

  try {
    await RNFS.downloadFile({
      fromUrl: downloadUrl,
      toFile: destPath,
      progress: (res) => {
        if (res.contentLength > 0) onProgress(res.bytesWritten / res.contentLength);
      },
      background: true,
      discretionary: true,
    }).promise;

    if (!(await RNFS.exists(destPath))) throw new Error("Download failed. File does not exist.");
    await loadModel(fileName);
    return destPath;
  } 
  catch (error) {
    Alert.alert("Error", error.message || "Failed to download model.");
  }
};

export const loadModel = async (modelName) => {
  try {
    const destPath = `${RNFS.DocumentDirectoryPath}/${modelName}`;
    if (!(await RNFS.exists(destPath))) {
      Alert.alert("Error", `Model file not found at ${destPath}`);
      return false;
    }

    if (context) {
      await releaseAllLlama();
      context = null;
    }

    if (!(await checkMemoryBeforeLoading(destPath))) return;

    context = await initLlama({
        model: destPath, 
        n_ctx: 2048,
        n_gpu_layers: 0 
    });

    return true;
  } catch (error) {
    Alert.alert("Error Loading Model", error.message || "An unknown error occurred.");
    return false;
  }
};

export const generateResponse = async (conversation) => {
    if (!context) {
      Alert.alert("Model Not Loaded", "Please load the model first.");
      return null;
    }
  
    const stopWords = [
      "</s>", 
      "<|end|>", 
      "user:", 
      "assistant:", 
      "<|im_end|>", 
      "<|eot_id|>", 
      "<|end▁of▁sentence|>"
    ];
  
  
    try {
      const filteredConversation = [
        {
          role: "system",
          content: "You are a highly specialized AI assistant for pregnancy-related topics. Only respond to questions about pregnancy, maternal health, fetal development, and prenatal care. If asked about anything else, politely refuse to answer.",
        },
        ...conversation,
      ];
  
      const result = await context.completion({
        messages: filteredConversation,
        n_predict: 10000,
        stop: stopWords
      });
  
      const response = result?.text?.trim();
      return response;

    } catch (error) {
      Alert.alert("Error During Inference", error.message || "An unknown error occurred.");
      return null;
    }
  };
  

