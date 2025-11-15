#!/usr/bin/env python3

def fibonacci(n: int) -> int:
    """
    Calculate the nth Fibonacci number using an iterative approach.
    
    Args:
        n: A non-negative integer representing the position in the Fibonacci sequence
           (0-based, where fibonacci(0) = 0, fibonacci(1) = 1)
    
    Returns:
        The nth Fibonacci number
        
    Raises:
        ValueError: If n is a negative integer
        
    Examples:
        >>> fibonacci(0)
        0
        >>> fibonacci(1)
        1
        >>> fibonacci(5)
        5
        >>> fibonacci(10)
        55
    """
    if n < 0:
        raise ValueError("n must be a non-negative integer")
    
    if n == 0:
        return 0
    elif n == 1:
        return 1
    
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    
    return b

def test_fibonacci():
    """Test cases for the fibonacci function"""
    # Test edge cases
    assert fibonacci(0) == 0, "fibonacci(0) should return 0"
    assert fibonacci(1) == 1, "fibonacci(1) should return 1"
    
    # Test known values
    assert fibonacci(2) == 1, "fibonacci(2) should return 1"
    assert fibonacci(3) == 2, "fibonacci(3) should return 2"
    assert fibonacci(5) == 5, "fibonacci(5) should return 5"
    assert fibonacci(10) == 55, "fibonacci(10) should return 55"
    assert fibonacci(15) == 610, "fibonacci(15) should return 610"
    assert fibonacci(20) == 6765, "fibonacci(20) should return 6765"
    
    # Test error handling
    try:
        fibonacci(-1)
        assert False, "fibonacci(-1) should raise ValueError"
    except ValueError:
        pass  # Expected
    
    try:
        fibonacci(-5)
        assert False, "fibonacci(-5) should raise ValueError"
    except ValueError:
        pass  # Expected
    
    print("All tests passed!")

if __name__ == "__main__":
    test_fibonacci()