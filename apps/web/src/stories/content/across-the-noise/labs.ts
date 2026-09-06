import type { LabDefinition, SceneId } from '../../types';

export const noiseLabs: Record<SceneId, LabDefinition> = {
  "scene-01": {
    "kind": "message-budget",
    "title": {"vi":"Giữ lời, bớt chữ","en":"Keep the Meaning, Shorten the Message"},
    "instruction": {
      "vi": "Viết một câu, rồi thử rút gọn nó trong giới hạn ký tự. So sánh điều còn lại với điều bạn muốn nói.",
      "en": "Write a message, then shorten it to fit the character budget. Compare what remains with what you meant."
    },
    "config": {"defaultBudget":30}
  },
  "scene-02": {
    "kind": "ambiguous-code",
    "title": {"vi":"Cùng một dấu, mấy cách đọc?","en":"One Signal, Several Readings"},
    "instruction": {
      "vi": "Đặt mã cho A, B, C, D. Gửi một chuỗi rồi xem người nhận có thể đọc theo những cách nào.",
      "en": "Assign codes to A, B, C and D. Send a sequence and inspect the receiver’s possible readings."
    },
    "config": {"initialBook":{"A":"0","B":"01","C":"1","D":"11"},"initialSymbols":"B"}
  },
  "scene-03": {
    "kind": "morse-spacing",
    "title": {"vi":"Đọc cả khoảng lặng","en":"Reading the Gaps"},
    "instruction": {
      "vi": "Giữ nguyên các dấu chấm và gạch. Thay khoảng nghỉ để xem thông điệp đổi cách phân đoạn.",
      "en": "Keep the dots and dashes unchanged. Change the pauses to see how the message is segmented."
    },
    "config": {"example":"ET"}
  },
  "scene-04": {
    "kind": "cable-route",
    "title": {"vi":"Chọn một đường qua biển","en":"Choosing a Route Across the Sea"},
    "instruction": {
      "vi": "So sánh ba tuyến giả lập. Chọn tuyến phù hợp ngân sách rồi kiểm tra bạn đang đánh đổi điều gì.",
      "en": "Compare three fictional routes. Choose one within budget and inspect its trade-offs."
    },
    "config": {"defaultBudget":28}
  },
  "scene-05": {
    "kind": "pulse-channel",
    "title": {"vi":"Xung còn nhận ra nhau không?","en":"Can the Pulses Still Be Distinguished?"},
    "instruction": {
      "vi": "Tăng tốc gửi mà giữ nguyên kênh. Quan sát thời điểm các xung bắt đầu làm khó người nhận.",
      "en": "Send faster through the same channel. Observe when neighboring pulses become harder to distinguish."
    },
    "config": {"defaultDuration":4}
  },
  "scene-06": {
    "kind": "binary-noise",
    "title": {"vi":"Một câu qua kênh nhiễu","en":"A Message Through Noise"},
    "instruction": {
      "vi": "Chọn mức nhiễu rồi truyền câu của bạn. Kiểm tra chính xác những bit nào đã đổi.",
      "en": "Choose a noise level and transmit your message. Inspect exactly which bits changed."
    },
    "config": {"defaultP":0.05,"seed":20260905}
  },
  "scene-07": {
    "kind": "source-entropy",
    "title": {"vi":"Đo một nguồn bất ngờ","en":"Measuring an Uncertain Source"},
    "instruction": {
      "vi": "Thay tần suất bốn ký hiệu. Dự đoán ký hiệu tiếp theo và quan sát độ bất định của cả nguồn.",
      "en": "Change the frequencies of four symbols. Predict the next symbol and observe the uncertainty of the source."
    },
    "config": {"weights":[25,25,25,25],"seed":20260905}
  },
  "scene-08": {
    "kind": "huffman-message",
    "title": {"vi":"Ít bit hơn, vẫn đủ chữ","en":"Fewer Bits, Every Character Preserved"},
    "instruction": {
      "vi": "Ghép các nhóm byte ít gặp trước. So sánh dữ liệu trước và sau nén, tính cả bảng mã cần gửi.",
      "en": "Merge the least frequent byte groups first. Compare sizes before and after encoding, including the codebook."
    },
    "config": {"maxVisibleNodes":31}
  },
  "scene-09": {
    "kind": "repetition-channel",
    "title": {"vi":"Thử gửi ba lần","en":"Trying Three Copies"},
    "instruction": {
      "vi": "So sánh gửi mỗi bit một lần và ba lần. Kiểm tra cái giá của việc biểu quyết.",
      "en": "Compare sending each bit once and three times. Inspect the cost of majority voting."
    },
    "config": {"defaultP":0.05,"seed":20260905}
  },
  "scene-10": {
    "kind": "secded-inspector",
    "title": {"vi":"Tìm vị trí cần sửa","en":"Locating the Bit to Repair"},
    "instruction": {
      "vi": "Tạo một khối bốn bit. Lật một hoặc hai bit trong khối được bảo vệ rồi đọc các phép kiểm tra.",
      "en": "Create a four-bit block. Flip one or two bits in its protected form and read the parity checks."
    },
    "config": {"data":"1011"}
  },
  "scene-11": {
    "kind": "channel-budget",
    "title": {"vi":"Chọn cách gửi trong một giới hạn","en":"Sending Within a Budget"},
    "instruction": {
      "vi": "Chọn ngân sách truyền, mức nhiễu và một mã. So sánh tốc độ hữu ích với khả năng nhận lại đúng câu.",
      "en": "Choose a transmission budget, noise level and code. Compare useful rate with exact message recovery."
    },
    "config": {"defaultBudget":4096,"defaultP":0.05,"seed":20260905}
  },
  "scene-12": {
    "kind": "message-meaning",
    "title": {"vi":"Cùng câu ấy, những cách hiểu khác","en":"The Same Words, Different Readings"},
    "instruction": {
      "vi": "Đối chiếu câu gửi và câu nhận. Sau đó đổi bối cảnh, nhưng giữ nguyên những chữ ấy.",
      "en": "Compare the sent and received message. Then change the context while keeping its words unchanged."
    },
    "config": {
      "contexts": [
        {"id":"meeting","label":{"vi":"cuộc hẹn thường ngày","en":"an ordinary meeting"}},
        {"id":"disagreement","label":{"vi":"hai người vừa bất đồng","en":"after a disagreement"}},
        {
          "id": "missing-previous",
          "label": {"vi":"người nhận thiếu câu trước","en":"the receiver missed the preceding message"}
        }
      ]
    }
  }
};
