import random
import time

def ascii_art_spinner():
    spinner = ['|', '/', '-', '\\']
    print("Generating your random lucky number...")
    for _ in range(20):
        for frame in spinner:
            print(f"\r{frame}", end="")
            time.sleep(0.1)
    print("\rDone! ✨")

def lucky_number_game():
    ascii_art_spinner()
    lucky_number = random.randint(1, 100)
    print(f"Your lucky number for today is: {lucky_number} 🍀")
    
    if lucky_number == 7:
        print("Wow! That's a super lucky number! 🌟")
    elif lucky_number > 90:
        print("You're feeling very lucky today! 🚀")
    else:
        print("Have a wonderful day! 😊")

if __name__ == "__main__":
    lucky_number_game()
